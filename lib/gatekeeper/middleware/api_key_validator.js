'use strict';

var _ = require('lodash'),
    ApiUser = require('../../models/api_user'),
    async = require('async'),
    cloneDeep = require('clone'),
    config = require('api-umbrella-config').global(),
    logger = require('../../logger'),
    mergeOverwriteArrays = require('object-extend'),
    utils = require('../utils');

var ApiKeyValidatorRequest = function() {
  this.initialize.apply(this, arguments);
};

_.extend(ApiKeyValidatorRequest.prototype, {
  initialize: function(validator, request, response, next) {
    this.validator = validator;
    this.request = request;
    this.response = response;
    this.next = next;

    var apiKey = this.resolveApiKey();
    if(apiKey) {
      request.apiUmbrellaGatekeeper.apiKey = apiKey;

      // FIXME: We're seeing mongo dropped connections on one of our servers
      // that's erroneously leading to bad api key errors. This seems sporadic
      // and related to mongo dropping connections:
      // https://support.mongolab.com/entries/23009358-handling-dropped-connections-on-windows-azure
      //
      // For now, let's try retrying the user lookup several times on failure
      // to allow the chance for the mongo connection to re-establish.
      var retriesCount = 0;
      var retriesError;
      var retriesUser;
      async.doWhilst(
        function(callback) {
          ApiUser.findOne({ api_key: request.apiUmbrellaGatekeeper.apiKey }, function(error, user) {
            retriesError = error;
            if(error) {
              retriesCount++;
              logger.info({ err: error, retry: retriesCount }, 'MongoDB find user error, retrying...');
              setTimeout(callback, 50); // Retry in 50ms.
            } else {
              retriesUser = user;
              callback();
            }
          });
        }.bind(this), function() {
          // Keep retrying while there's an error for a while.
          return (retriesError && retriesCount < 1000);
        }, function(error) {
          if(error || retriesError) {
            logger.error({ error: error, retriesError: retriesError, retry: retriesCount, userFound: !!retriesUser }, 'Error fetching user');
          } else if(retriesCount > 0) {
            logger.info({ retry: retriesCount, userFound: !!retriesUser }, 'User query succeeded after retries');
          }

          this.handleUser(request, error, retriesUser);
        }.bind(this));
    } else {
      if(request.apiUmbrellaGatekeeper.settings && request.apiUmbrellaGatekeeper.settings.disable_api_key) {
        next();
      } else {
        utils.errorHandler(this.request, this.response, 'api_key_missing');
      }
    }
  },

  resolveApiKey: function() {
    var apiKey;
    var headerName = config.get('gatekeeper.api_key_header_name').toLowerCase();
    var paramName = config.get('gatekeeper.api_key_param_name');

    for(var i = 0, len = this.validator.apiKeyMethods.length; i < len; i++) {
      switch(this.validator.apiKeyMethods[i]) {
      case 'header':
        apiKey = this.request.headers[headerName];
        break;
      case 'getParam':
        apiKey = this.request.query[paramName];
        break;
      case 'basicAuthUsername':
        apiKey = this.request.basicAuthUsername;
        break;
      }

      if(apiKey) {
        break;
      }
    }

    return apiKey;
  },

  handleUser: function(request, error, user) {
    if(error) {
      logger.error({ err: error }, 'Failed to find user');
    }

    if(!user) {
      return utils.errorHandler(this.request, this.response, 'api_key_invalid');
    }

    if(user.disabled_at) {
      return utils.errorHandler(this.request, this.response, 'api_key_disabled');
    }

    var verificationLevel = request.apiUmbrellaGatekeeper.settings.api_key_verification_level;
    if(verificationLevel === 'required_email') {
      if(!user.email_verified) {
        return utils.errorHandler(this.request, this.response, 'api_key_unverified');
      }
    } else if(verificationLevel === 'transition_email') {
      var transitionStartAt = request.apiUmbrellaGatekeeper.settings.api_key_verification_transition_start_at;
      if(user.created_at && user.created_at >= transitionStartAt && !user.email_verified) {
        return utils.errorHandler(this.request, this.response, 'api_key_unverified');
      }
    }

    this.request.apiUmbrellaGatekeeper.user = user;

    if(user.settings) {
      // Delete a "null" value for a user-specific rate limit mode, since
      // we don't want that to overwrite the API-specific settings during
      // the settings merge.
      if(user.settings.rate_limit_mode === null) {
        delete user.settings.rate_limit_mode;
      }

      // Similarly, if the user has an empty custom rate limits array
      // assigned to it, be sure that doesn't take precedence over the
      // default rate limits.
      if(user.settings.rate_limits && user.settings.rate_limits.length === 0) {
        delete user.settings.rate_limits;
      }

      request.apiUmbrellaGatekeeper.originalUserSettings = cloneDeep(user.settings);
      mergeOverwriteArrays(request.apiUmbrellaGatekeeper.settings, user.settings);
    }

    this.next();
  },
});

var ApiKeyValidator = function() {
  this.initialize.apply(this, arguments);
};

_.extend(ApiKeyValidator.prototype, {
  initialize: function() {
    this.apiKeyMethods = config.get('gatekeeper.api_key_methods');
  },

  handleRequest: function(request, response, next) {
    new ApiKeyValidatorRequest(this, request, response, next);
  },
});

module.exports = function apiKeyValidator() {
  var middleware = new ApiKeyValidator();

  return function(request, response, next) {
    middleware.handleRequest(request, response, next);
  };
};
