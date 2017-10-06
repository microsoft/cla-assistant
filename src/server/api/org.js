var org = require('../services/org');
var github = require('../services/github');
var log = require('../services/logger');
var q = require('q');
var Joi = require('joi');
var webhook = require('./webhook');

var extractIds = function(orgs) {
    var ids = [];
    try {
        orgs.forEach(function(org) {
            ids.push(org.id);
        });
    } catch (ex) {

    }
    return ids;
};
module.exports = {

    // check: function(req, done) {
    //     org.check(req.args, done);
    // },
    create: function (req, done) {
        req.args.token = req.args.token || req.user.token;
        var schema = Joi.object().keys({
            orgId: Joi.number().required(),
            org: Joi.string().required(),
            gist: Joi.string().required(),
            token: Joi.string().required(),
            excludePattern: Joi.string(),
            sharedGist: Joi.boolean(),
            minFileChanges: Joi.number(),
            minCodeChanges: Joi.number()
        });
        Joi.validate(req.args, schema, { abortEarly: false, allowUnknown: true }, function (joiError) {
            if (joiError) {
                joiError.code = 400;
                return done(joiError);
            }
            var query = {
                orgId: req.args.orgId,
                org: req.args.org,
            };
            org.get(query, function (err, dbOrg) {
                if (dbOrg) {
                    return done('This org is already linked.');
                }
                org.create(req.args, function (createOrgErr, dbOrg) {
                    if (createOrgErr) {
                        return done(createOrgErr);
                    }
                    webhook.create(req, function (createHookErr) {
                        done(createHookErr, dbOrg);
                    });
                });
            });
        });
    },
    getForUser: function(req, done) {
        this.getGHOrgsForUser(req, function(err, res) {
            if (err) {
                log.warn(err);
                done(err);
                return;
            }
            var argsForOrg = {
                orgId: extractIds(res)
            };
            org.getMultiple(argsForOrg, done);
        });
    },

    getGHOrgsForUser: function(req, done) { // TODO: test it!
        var promises = [];
        var argsForGithub = {
            obj: 'users',
            fun: 'getOrgs',
            token: req.user.token
        };
        github.call(argsForGithub, function(err, res) {
            if (err) {
                log.warn(err);
                done(err);
                return;
            }
            var orgs = res;
            var adminOrgs = [];

            if (orgs instanceof Array) {
                orgs.forEach(function(org) {
                    argsForGithub.fun = 'getOrgMembership';
                    argsForGithub.arg = { org: org.login };
                    var promise = github.call(argsForGithub).then(function(info) {
                        if (info && info.data && info.data.role === 'admin') {
                            adminOrgs.push(org);
                        }
                    });
                    promises.push(promise);
                });
                q.all(promises).then(function() {
                    done(null, adminOrgs);
                });

            } else {
                done(err ? err :  'Could not find github orgs');
            }
        });
    },
    // update: function(req, done){
    //     org.update(req.args, done);
    // },
    remove: function (req, done) {
        var schema = Joi.object().keys({
            org: Joi.string(),
            orgId: Joi.number()
        }).or('org', 'orgId');
        Joi.validate(req.args, schema, { abortEarly: false }, function (joiError) {
            if (joiError) {
                joiError.code = 400;
                return done(joiError);
            }
            org.remove(req.args, function (removeOrgErr, dbOrg) {
                if (removeOrgErr) {
                    return done(removeOrgErr);
                }
                req.args.org = dbOrg.org;
                webhook.remove(req, function (removeHookErr) {
                    done(removeHookErr, dbOrg);
                });
            });
        });
    }
};
