local cidr = require "libcidr-ffi"
local cjson = require "cjson"
local escape_regex = require "api-umbrella.utils.escape_regex"
local host_normalize = require "api-umbrella.utils.host_normalize"
local load_backends = require "api-umbrella.proxy.load_backends"
local plutils = require "pl.utils"
local tablex = require "pl.tablex"
local utils = require "api-umbrella.proxy.utils"

local append_array = utils.append_array
local cache_computed_settings = utils.cache_computed_settings
local deepcopy = tablex.deepcopy
local escape = plutils.escape
local set_packed = utils.set_packed
local size = tablex.size
local split = plutils.split

local _M = {}

local function set_hostname_regex(record, key)
  if record[key] then
    local host = host_normalize(record[key])

    local normalized_key = "_" .. key .. "_normalized"
    record[normalized_key] = host

    local wildcard_regex_key = "_" .. key .. "_wildcard_regex"
    if string.sub(host, 1, 1)  == "." then
      record[wildcard_regex_key] = "^(.+\\.|)" .. escape_regex(string.sub(host, 2)) .. "$"
    elseif string.sub(host, 1, 2) == "*." then
      record[wildcard_regex_key] = "^(.+)" .. escape_regex(string.sub(host, 2)) .. "$"
    elseif host == "*" then
      record[wildcard_regex_key] = "^(.+)$"
    end
  end
end

local function cache_computed_api(api)
  if not api then return end

  if api["frontend_host"] then
    set_hostname_regex(api, "frontend_host")
  end

  if api["backend_host"] == "" then
    api["backend_host"] = nil
  end

  if api["backend_host"] then
    api["_backend_host_normalized"] = host_normalize(api["backend_host"])
  end

  if api["url_matches"] then
    for _, url_match in ipairs(api["url_matches"]) do
      url_match["_frontend_prefix_matcher"] = "^" .. escape(url_match["frontend_prefix"])
      url_match["_backend_prefix_matcher"] = "^" .. escape(url_match["backend_prefix"])
    end
  end

  if api["servers"] then
    for _, server in ipairs(api["servers"]) do
      if server["host"] then
        if cidr.from_str(server["host"]) then
          server["_host_is_ip?"] = true
        end
      end
    end
  end

  if api["rewrites"] then
    for _, rewrite in ipairs(api["rewrites"]) do
      rewrite["http_method"] = string.lower(rewrite["http_method"])

      -- Route pattern matching implementation based on
      -- https://github.com/bjoerge/route-pattern
      -- TODO: Cleanup!
      if rewrite["matcher_type"] == "route" then
        local backend_replacement = string.gsub(rewrite["backend_replacement"], "{{([^{}]-)}}", "{{{%1}}}")
        local backend_parts = split(backend_replacement, "?", true, 2)
        rewrite["_backend_replacement_path"] = backend_parts[1]
        rewrite["_backend_replacement_args"] = backend_parts[2]

        local frontend_parts = split(rewrite["frontend_matcher"], "?", true, 2)
        local path = frontend_parts[1]
        local args = frontend_parts[2]

        local escapeRegExp = "[\\-{}\\[\\]+?.,\\\\^$|#\\s]"
        local namedParam = [[:(\w+)]]
        local splatNamedParam = [[\*(\w+)]]
        local subPath = [[\*([^\w]|$)]]

        local frontend_path_regex = ngx.re.gsub(path, escapeRegExp, "\\$0")
        frontend_path_regex = ngx.re.gsub(frontend_path_regex, subPath, [[.*?$1]])
        frontend_path_regex = ngx.re.gsub(frontend_path_regex, namedParam, [[(?<$1>[^/]+)]])
        frontend_path_regex = ngx.re.gsub(frontend_path_regex, splatNamedParam, [[(?<$1>.*?)]])
        frontend_path_regex = ngx.re.gsub(frontend_path_regex, "/$", "")
        rewrite["_frontend_path_regex"] = "^" .. frontend_path_regex .. "/?$"

        if args then
          args = ngx.decode_args(args)
          rewrite["_frontend_args_length"] = size(args)
          rewrite["_frontend_args"] = {}
          for key, value in pairs(args) do
            if key == "*" and value == true then
              rewrite["_frontend_args_allow_wildcards"] = true
            else
              rewrite["_frontend_args"][key] = {}
              if type(value) == "string" and string.sub(value, 1, 1) == ":" then
                rewrite["_frontend_args"][key]["named_capture"] = string.sub(value, 2, -1)
              else
                rewrite["_frontend_args"][key]["must_equal"] = value
              end
            end
          end
        end
      end
    end
  end
end

local function cache_computed_sub_settings(sub_settings)
  if not sub_settings then return end

  for _, sub_setting in ipairs(sub_settings) do
    if sub_setting["http_method"] then
      sub_setting["http_method"] = string.lower(sub_setting["http_method"])
    end

    if sub_setting["settings"] then
      cache_computed_settings(sub_setting["settings"])
    else
      sub_setting["settings"] = {}
    end
  end
end

local function define_host(hosts_by_name, hostname)
  hostname = host_normalize(hostname)
  if hostname and not hosts_by_name[hostname] then
    hosts_by_name[hostname] = {
      hostname = hostname,
    }
  end

  return hostname
end

local function sort_by_hostname_length(a, b)
  return string.len(tostring(a["hostname"])) > string.len(tostring(b["hostname"]))
end

local function parse_hosts(hosts, hosts_by_name)
  for _, host in ipairs(hosts) do
    local hostname = host_normalize(host["hostname"])
    if hostname then
      hosts_by_name[hostname] = host
    end
  end
end

local function parse_apis(apis, hosts_by_name)
  for _, api in ipairs(apis) do
    if not api["_id"] then
      api["_id"] = ngx.md5(cjson.encode(api))
    end

    cache_computed_api(api)
    cache_computed_settings(api["settings"])
    cache_computed_sub_settings(api["sub_settings"])
    define_host(hosts_by_name, api["frontend_host"])
  end
end

local function parse_website_backends(website_backends, hosts_by_name)
  for _, website_backend in ipairs(website_backends) do
    if not website_backend["_id"] then
      website_backend["_id"] = ndk.set_var.set_secure_random_alphanum(32)
    end

    local hostname = define_host(hosts_by_name, website_backend["frontend_host"])
    if hostname then
      hosts_by_name[hostname]["_website_backend?"] = true
      hosts_by_name[hostname]["_website_host"] = website_backend["frontend_host"]
      hosts_by_name[hostname]["_website_protocol"] = website_backend["backend_protocol"] or "http"
      hosts_by_name[hostname]["_website_server_host"] = website_backend["server_host"]
      hosts_by_name[hostname]["_website_server_port"] = website_backend["server_port"]
      hosts_by_name[hostname]["_website_backend_required_https_regex"] = website_backend["website_backend_required_https_regex"] or config["router"]["website_backend_required_https_regex_default"]
    end
  end
end

local function build_all_hosts(hosts_by_name)
  local hosts = tablex.values(hosts_by_name)
  table.sort(hosts, sort_by_hostname_length)
  for _, host in ipairs(hosts) do
    set_hostname_regex(host, "hostname")

    if host["enable_web_backend"] ~= nil then
      host["_web_backend?"] = host["enable_web_backend"]
    elseif host["_web_backend?"] == nil then
      host["_web_backend?"] = (host["default"] == true)
    end
  end

  return hosts
end

local function build_active_config(hosts, apis, website_backends)
  local hosts_by_name = {}
  parse_hosts(hosts, hosts_by_name)
  parse_apis(apis, hosts_by_name)
  parse_website_backends(website_backends, hosts_by_name)

  local active_config = {
    apis = apis,
    hosts = build_all_hosts(hosts_by_name),
  }

  return active_config
end

local function get_combined_apis(file_config, db_config)
  local file_config_apis = deepcopy(file_config["_apis"]) or {}
  local db_config_apis = db_config["apis"] or {}

  local all_apis = {}
  append_array(all_apis, file_config_apis)
  append_array(all_apis, db_config_apis)
  return all_apis
end

local function get_combined_website_backends(file_config, db_config)
  local file_config_website_backends = deepcopy(file_config["_website_backends"]) or {}
  local db_config_website_backends = db_config["website_backends"] or {}

  local all_website_backends = {}
  append_array(all_website_backends, file_config_website_backends)
  append_array(all_website_backends, db_config_website_backends)
  return all_website_backends
end

function _M.set(db_config)
  local file_config = config
  if not db_config then
    db_config = {}
  end

  local hosts = deepcopy(file_config["hosts"]) or {}
  local apis = get_combined_apis(file_config, db_config)
  local website_backends = get_combined_website_backends(file_config, db_config)

  local active_config = build_active_config(hosts, apis, website_backends)
  load_backends.setup_backends(active_config["apis"])

  set_packed(ngx.shared.active_config, "packed_data", active_config)
  ngx.shared.active_config:set("db_version", db_config["version"])
  ngx.shared.active_config:set("file_version", file_config["version"])
  ngx.shared.active_config:set("worker_group_setup_complete:" .. WORKER_GROUP_ID, true)
end

return _M