'use strict';

require('../test_helper');

var request = require('request');

describe('ApiUmbrellaGatekeper', function() {
  describe('api matching', function() {
    describe('host matching', function() {
      shared.runServer({
        gatekeeper: {
          default_frontend_host: 'default-host-config.example.com',
        },
        apis: [
          {
            'frontend_host': 'localhost:7777',
            'backend_host': 'example.com',
            '_id': 'localhost-non-matching-port',
            'url_matches': [
              {
                'frontend_prefix': '/info/matching/',
                'backend_prefix': '/info/matching/'
              }
            ]
          },
          {
            'frontend_host': 'localhost:9333',
            'backend_host': 'example.com',
            '_id': 'localhost-with-port',
            'url_matches': [
              {
                'frontend_prefix': '/info/matching/',
                'backend_prefix': '/info/matching/'
              }
            ]
          },
          {
            'frontend_host': 'localhost:80',
            'backend_host': 'example.com',
            '_id': 'localhost-default-port',
            'url_matches': [
              {
                'frontend_prefix': '/info/matching/',
                'backend_prefix': '/info/matching/'
              }
            ]
          },
          {
            'frontend_host': 'localhost:443',
            'backend_host': 'example.com',
            '_id': 'localhost-ssl-port',
            'url_matches': [
              {
                'frontend_prefix': '/info/matching/',
                'backend_prefix': '/info/matching/'
              }
            ]
          },
          {
            'frontend_host': 'fallback.example.com',
            'backend_host': 'example.com',
            '_id': 'fallback-no-port',
            'url_matches': [
              {
                'frontend_prefix': '/info/matching/',
                'backend_prefix': '/info/matching/'
              }
            ]
          },
          {
            'frontend_host': '.wild-just-dot-subdomain.foo',
            'backend_host': 'example.com',
            '_id': 'wildcard-just-dot-subdomain',
            'url_matches': [
              {
                'frontend_prefix': '/info/wildcard-subdomain/',
                'backend_prefix': '/info/wildcard-subdomain/'
              }
            ]
          },
          {
            'frontend_host': '*wild-without-dot-subdomain.foo',
            'backend_host': 'example.com',
            '_id': 'wildcard-without-dot-subdomain',
            'url_matches': [
              {
                'frontend_prefix': '/info/wildcard-subdomain/',
                'backend_prefix': '/info/wildcard-subdomain/'
              }
            ]
          },
          {
            'frontend_host': '*.wild-with-dot-subdomain.foo',
            'backend_host': 'example.com',
            '_id': 'wildcard-with-dot-subdomain',
            'url_matches': [
              {
                'frontend_prefix': '/info/wildcard-subdomain/',
                'backend_prefix': '/info/wildcard-subdomain/'
              }
            ]
          },
          {
            'frontend_host': '*',
            'backend_host': 'example.com',
            '_id': 'wildcard',
            'url_matches': [
              {
                'frontend_prefix': '/info/wildcard/',
                'backend_prefix': '/info/wildcard/'
              }
            ]
          },
          {
            'frontend_host': 'wildcard-coexist.example.com',
            'backend_host': 'example.com',
            '_id': 'host-over-wildcard',
            'url_matches': [
              {
                'frontend_prefix': '/info/wildcard-coexist/',
                'backend_prefix': '/info/wildcard-coexist/'
              }
            ]
          },
          {
            'frontend_host': '*.wildcard-backend-star-dot.foo',
            'backend_host': '*.example.com',
            '_id': 'wildcard-backend-star-dot',
            'url_matches': [
              {
                'frontend_prefix': '/info/wildcard-backend/',
                'backend_prefix': '/info/wildcard-backend/'
              }
            ]
          },
          {
            'frontend_host': '.wildcard-backend-dot.foo',
            'backend_host': '.example.com',
            '_id': 'wildcard-backend-dot',
            'url_matches': [
              {
                'frontend_prefix': '/info/wildcard-backend/',
                'backend_prefix': '/info/wildcard-backend/'
              }
            ]
          },
          {
            'frontend_host': 'default-host-config.example.com',
            'backend_host': 'example.com',
            '_id': 'default-host-config',
            'url_matches': [
              {
                'frontend_prefix': '/info/default-host-config/',
                'backend_prefix': '/info/default-host-config/'
              }
            ]
          },

        ],
      });

      it('uses full host with port to find the matching api', function(done) {
        var opts = shared.buildRequestOptions('/info/matching/', this.apiKey);
        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('localhost-with-port');
          done();
        });
      });

      it('prefers the host header', function(done) {
        var opts = shared.buildRequestOptions('/info/matching/', this.apiKey, {
          headers: {
            'Host': 'localhost:80',
          },
        });

        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('localhost-default-port');
          done();
        });
      });

      it('fills in host headers with missing ports with defaults', function(done) {
        var opts = shared.buildRequestOptions('/info/matching/', this.apiKey, {
          headers: {
            'Host': 'localhost',
          },
        });

        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('localhost-default-port');
          done();
        });
      });

      it('determines the default ports based on the protocol', function(done) {
        var opts = shared.buildRequestOptions('/info/matching/', this.apiKey, {
          headers: {
            'Host': 'localhost',
            'X-Forwarded-Proto': 'https',
          },
        });

        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('localhost-ssl-port');
          done();
        });
      });

      it('falls back to the hostname when using a standard port', function(done) {
        var opts = shared.buildRequestOptions('/info/matching/', this.apiKey, {
          headers: {
            'Host': 'fallback.example.com:80',
          },
        });

        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('fallback-no-port');
          done();
        });
      });

      it('falls back to the hostname when using a non-standard port', function(done) {
        var opts = shared.buildRequestOptions('/info/matching/', this.apiKey, {
          headers: {
            'Host': 'fallback.example.com:123',
          },
        });

        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('fallback-no-port');
          done();
        });
      });

      it('falls back to wildcard hostnames if no other hostname matches', function(done) {
        var opts = shared.buildRequestOptions('/info/wildcard/', this.apiKey, {
          headers: {
            'Host': 'google.com:789',
          },
        });

        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('wildcard');
          data.headers['host'].should.eql('example.com');
          done();
        });
      });

      it('can still fallback to wildcard apis even if a matching host is present for other apis', function(done) {
        var opts = shared.buildRequestOptions('/info/wildcard/', this.apiKey, {
          headers: {
            'Host': 'wildcard-coexist.example.com',
          },
        });

        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('wildcard');
          data.headers['host'].should.eql('example.com');
          done();
        });
      });

      describe('wildcard subdomains', function() {
        describe('*. prefix', function() {
          it('matches wildcard subdomains', function(done) {
            var opts = shared.buildRequestOptions('/info/wildcard-subdomain/', this.apiKey, {
              headers: {
                'Host': 'foo.wild-with-dot-subdomain.foo',
              },
            });

            request.get(opts, function(error, response, body) {
              var data = JSON.parse(body);
              data.headers['x-api-umbrella-backend-id'].should.eql('wildcard-with-dot-subdomain');
              data.headers['host'].should.eql('example.com');
              done();
            });
          });

          describe('does not match the root domain itself', function() {
            shared.itBehavesLikeGatekeeperBlocked('/info/wildcard-subdomain/', 404, 'NOT_FOUND', {
              headers: {
                'Host': 'wild-with-dot-subdomain.foo',
              },
            });
          });

          describe('does not match wildcards without the dot boundary', function() {
            shared.itBehavesLikeGatekeeperBlocked('/info/wildcard-subdomain/', 404, 'NOT_FOUND', {
              headers: {
                'Host': 'foowild-with-dot-subdomain.foo',
              },
            });
          });

          describe('does not match domains with extra trailing text', function() {
            shared.itBehavesLikeGatekeeperBlocked('/info/wildcard-subdomain/', 404, 'NOT_FOUND', {
              headers: {
                'Host': 'foo.wild-with-dot-subdomain.foobar',
              },
            });
          });

          it('matches domain with extra port information', function(done) {
            var opts = shared.buildRequestOptions('/info/wildcard-subdomain/', this.apiKey, {
              headers: {
                'Host': 'foo.wild-with-dot-subdomain.foo:80',
              },
            });

            request.get(opts, function(error, response, body) {
              var data = JSON.parse(body);
              data.headers['x-api-umbrella-backend-id'].should.eql('wildcard-with-dot-subdomain');
              data.headers['host'].should.eql('example.com');
              done();
            });
          });

          it('replaces wildcard subdomains in backend hosts', function(done) {
            var opts = shared.buildRequestOptions('/info/wildcard-backend/', this.apiKey, {
              headers: {
                'Host': 'foo.wildcard-backend-star-dot.foo',
              },
            });

            request.get(opts, function(error, response, body) {
              var data = JSON.parse(body);
              data.headers['x-api-umbrella-backend-id'].should.eql('wildcard-backend-star-dot');
              data.headers['host'].should.eql('foo.example.com');
              done();
            });
          });

          it('replaces wildcard subdomains multiple levels deep in backend hosts', function(done) {
            var opts = shared.buildRequestOptions('/info/wildcard-backend/', this.apiKey, {
              headers: {
                'Host': 'foo.bar.wildcard-backend-star-dot.foo',
              },
            });

            request.get(opts, function(error, response, body) {
              var data = JSON.parse(body);
              data.headers['x-api-umbrella-backend-id'].should.eql('wildcard-backend-star-dot');
              data.headers['host'].should.eql('foo.bar.example.com');
              done();
            });
          });

        });

        describe('. prefix', function() {
          it('matches wildcard subdomains', function(done) {
            var opts = shared.buildRequestOptions('/info/wildcard-subdomain/', this.apiKey, {
              headers: {
                'Host': 'foo.wild-just-dot-subdomain.foo',
              },
            });

            request.get(opts, function(error, response, body) {
              var data = JSON.parse(body);
              data.headers['x-api-umbrella-backend-id'].should.eql('wildcard-just-dot-subdomain');
              data.headers['host'].should.eql('example.com');
              done();
            });
          });

          it('matches the root domain itself', function(done) {
            var opts = shared.buildRequestOptions('/info/wildcard-subdomain/', this.apiKey, {
              headers: {
                'Host': 'wild-just-dot-subdomain.foo',
              },
            });

            request.get(opts, function(error, response, body) {
              var data = JSON.parse(body);
              data.headers['x-api-umbrella-backend-id'].should.eql('wildcard-just-dot-subdomain');
              data.headers['host'].should.eql('example.com');
              done();
            });
          });

          describe('does not match wildcards without the dot boundary', function() {
            shared.itBehavesLikeGatekeeperBlocked('/info/wildcard-subdomain/', 404, 'NOT_FOUND', {
              headers: {
                'Host': 'foowild-just-dot-subdomain.foo',
              },
            });
          });

          describe('does not match domains with extra trailing text', function() {
            shared.itBehavesLikeGatekeeperBlocked('/info/wildcard-subdomain/', 404, 'NOT_FOUND', {
              headers: {
                'Host': 'foo.wild-just-dot-subdomain.foobar',
              },
            });
          });

          it('matches domain with extra port information', function(done) {
            var opts = shared.buildRequestOptions('/info/wildcard-subdomain/', this.apiKey, {
              headers: {
                'Host': 'foo.wild-just-dot-subdomain.foo:80',
              },
            });

            request.get(opts, function(error, response, body) {
              var data = JSON.parse(body);
              data.headers['x-api-umbrella-backend-id'].should.eql('wildcard-just-dot-subdomain');
              data.headers['host'].should.eql('example.com');
              done();
            });
          });

          it('replaces wildcard subdomains in backend hosts', function(done) {
            var opts = shared.buildRequestOptions('/info/wildcard-backend/', this.apiKey, {
              headers: {
                'Host': 'foo.wildcard-backend-dot.foo',
              },
            });

            request.get(opts, function(error, response, body) {
              var data = JSON.parse(body);
              data.headers['x-api-umbrella-backend-id'].should.eql('wildcard-backend-dot');
              data.headers['host'].should.eql('foo.example.com');
              done();
            });
          });

          it('replaces wildcard backend hosts with nothing if accessing the root', function(done) {
            var opts = shared.buildRequestOptions('/info/wildcard-backend/', this.apiKey, {
              headers: {
                'Host': 'wildcard-backend-dot.foo',
              },
            });

            request.get(opts, function(error, response, body) {
              var data = JSON.parse(body);
              data.headers['x-api-umbrella-backend-id'].should.eql('wildcard-backend-dot');
              data.headers['host'].should.eql('example.com');
              done();
            });
          });
        });

        describe('* prefix', function() {
          describe('does not match wildcard subdomains', function() {
            shared.itBehavesLikeGatekeeperBlocked('/info/wildcard-subdomain/', 404, 'NOT_FOUND', {
              headers: {
                'Host': 'foo.wild-without-dot-subdomain.foo',
              },
            });
          });

          describe('does not match the root domain itself', function() {
            shared.itBehavesLikeGatekeeperBlocked('/info/wildcard-subdomain/', 404, 'NOT_FOUND', {
              headers: {
                'Host': 'wild-without-dot-subdomain.foo',
              },
            });
          });

          describe('does not match wildcards without the dot boundary', function() {
            shared.itBehavesLikeGatekeeperBlocked('/info/wildcard-subdomain/', 404, 'NOT_FOUND', {
              headers: {
                'Host': 'foowild-without-dot-subdomain.foo',
              },
            });
          });
        });

        describe('escapes other possible regex characters in domain', function() {
          shared.itBehavesLikeGatekeeperBlocked('/info/wildcard-subdomain/', 404, 'NOT_FOUND', {
            headers: {
              'Host': 'foo.wild-with-dot-subdomainXfoo',
            },
          });
        });
      });


      it('allows a configurable default host to fallback to', function(done) {
        var opts = shared.buildRequestOptions('/info/default-host-config/', this.apiKey, {
          headers: {
            'Host': 'google.com:890',
          },
        });

        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('default-host-config');
          done();
        });
      });

      describe('non-matching host', function() {
        shared.itBehavesLikeGatekeeperBlocked('/info/matching/', 404, 'NOT_FOUND', {
          headers: {
            'Host': 'unmatched.example.com',
          },
        });
      });
    });

    describe('prefix matching', function() {
      shared.runServer({
        apis: [
          {
            'frontend_host': 'localhost',
            'backend_host': 'example.com',
            '_id': 'other-prefix',
            'url_matches': [
              {
                'frontend_prefix': '/info/other/',
                'backend_prefix': '/info/other/'
              }
            ],
          },
          {
            'frontend_host': 'unused.example.com',
            'backend_host': 'example.com',
            '_id': 'specific-prefix-different-host',
            'url_matches': [
              {
                'frontend_prefix': '/info/specific/',
                'backend_prefix': '/info/specific/'
              }
            ],
          },
          {
            'frontend_host': 'localhost',
            'backend_host': 'example.com',
            '_id': 'specific-prefix',
            'url_matches': [
              {
                'frontend_prefix': '/info/specific/',
                'backend_prefix': '/info/specific/'
              }
            ],
          },
        ],
      });

      it('matches based on host and prefix combination', function(done) {
        var opts = shared.buildRequestOptions('/info/specific/', this.apiKey);
        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('specific-prefix');
          done();
        });
      });

      it('ignores everything past the matching prefix', function(done) {
        var opts = shared.buildRequestOptions('/info/specific/abc/xyz', this.apiKey);
        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.headers['x-api-umbrella-backend-id'].should.eql('specific-prefix');
          done();
        });
      });

      describe('non-matching prefixes', function() {
        describe('mismatched trailing slash', function() {
          shared.itBehavesLikeGatekeeperBlocked('/info/specific', 404, 'NOT_FOUND');
        });

        describe('mismatched case sensitivity', function() {
          shared.itBehavesLikeGatekeeperBlocked('/info/SPECIFIC/', 404, 'NOT_FOUND');
        });
      });
    });

    describe('request rewriting', function() {
      shared.runServer({
        apis: [
          {
            'frontend_host': 'localhost',
            'backend_host': 'example.com',
            '_id': 'rewrites',
            'url_matches': [
              {
                'frontend_prefix': '/info/incoming/',
                'backend_prefix': '/info/outgoing/'
              }
            ],
          },
        ],
      });

      it('rewrites the prefix', function(done) {
        var opts = shared.buildRequestOptions('/info/incoming/example', this.apiKey);
        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.url.path.should.eql('/info/outgoing/example');
          done();
        });
      });

      it('maintains query string parameters when rewriting the prefix', function(done) {
        var opts = shared.buildRequestOptions('/info/incoming/example?param1=value1&param2=value2', this.apiKey);
        request.get(opts, function(error, response, body) {
          var data = JSON.parse(body);
          data.url.path.should.eql('/info/outgoing/example?param1=value1&param2=value2');
          done();
        });
      });
    });
  });
});
