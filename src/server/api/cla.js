// modules
var async = require('async');
var q = require('q');
var Joi = require('joi');

// services
var github = require('../services/github');
var cla = require('../services/cla');
var status = require('../services/status');
var repoService = require('../services/repo');
var orgService = require('../services/org');
var prService = require('../services/pullRequest');
var log = require('../services/logger');

var config = require('../../config');

var token;

function markdownRender(content, token) {
    var deferred = q.defer();
    var args = {
        obj: 'misc',
        fun: 'renderMarkdown',
        arg: {
            text: content
        },
        token: token
    };

    github.call(args, function (error, response) {
        var callback_error;
        if (!response || response.statusCode !== 200) {
            callback_error = response && response.message ? response.message : error;
            if (callback_error) {
                deferred.reject(callback_error);
                return;
            }
        }
        if (response) {
            deferred.resolve({
                raw: response.body || response.data || response
            });
        } else {
            deferred.reject(callback_error);
        }

    });
    return deferred.promise;
}

function renderFiles(files, renderToken) {
    var deferred = q.defer();
    try {
        var content;
        Object.keys(files).some(function (name) {
            content = name != 'metadata' ? files[name].content : content;
            return name != 'metadata';
        });
    } catch (e) {
        deferred.reject(e);
        return deferred.promise;
    }
    var metadata = files && files['metadata'] ? files['metadata'].content : undefined;

    var gistContent = {},
        contentPromise, metaPromise;
    contentPromise = markdownRender(content, renderToken).then(function (data) {
        return data.raw;
    });
    if (metadata) {
        metaPromise = markdownRender(metadata, renderToken).then(function (data) {
            return data.raw;
        });
    }
    q.all([contentPromise, metaPromise]).then(function (data) {
            gistContent.raw = data[0];
            gistContent.meta = data[1];
            deferred.resolve(gistContent);
        },
        function (msg) {
            deferred.reject(msg);
        });
    return deferred.promise;
}

function getLinkedItemsWithSharedGist(gist, done) {
    if (!gist) {
        return done('Gist is required.');
    }
    repoService.getRepoWithSharedGist(gist, function (error, repos) {
        if (error) {
            log.error(error);
        }
        orgService.getOrgWithSharedGist(gist, function (err, orgs) {
            if (err) {
                log.error(err);
            }
            done(null, {
                repos: repos,
                orgs: orgs
            });
        });
    });
}

function getReposNeedToValidate(req, done) {
    var repos = [];
    github.call({
        obj: 'repos',
        fun: 'getForOrg',
        arg: {
            org: req.args.org,
            per_page: 100
        },
        token: req.args.token || req.user.token
    }, function (error, allRepos) {
        if ((allRepos && allRepos.message) || error || (allRepos && allRepos.length === 0)) {
            return done((allRepos && allRepos.message) || error, repos);
        }
        orgService.get(req.args, function (err, linkedOrg) {
            if (err) {
                return done(err, repos);
            }
            repoService.getByOwner(req.args.org, function (er, linkedRepos) {
                if (er) {
                    return done(er, repos);
                }
                var linkedRepoSet = new Set(linkedRepos.map(function (linkedRepo) {
                    return linkedRepo.repoId.toString();
                }));
                repos = allRepos.filter(function (repo) {
                    if (linkedOrg.isRepoExcluded !== undefined && linkedOrg.isRepoExcluded(repo.name)) {
                        // The repo has been excluded.
                        return false;
                    }
                    if (linkedRepoSet.has(repo.id.toString())) {
                        // The repo has a separate CLA.
                        return false;
                    }
                    return true;
                });
                done(null, repos);
            });
        });
    });
}

module.exports = {
    getGist: function (req, done) {
        var schema = Joi.object().keys({
            gist: Joi.alternatives([Joi.string().uri(), Joi.object().keys({ gist_url: Joi.string().uri(), gist_version: Joi.strict() })]),
            repoId: Joi.number(),
            orgId: Joi.number(),
            repo: Joi.string(),
            owner: Joi.string()
        });
        Joi.validate(req.args, schema, { abortEarly: false }, function (joiErr) {
            if (joiErr) {
                return done(joiErr);
            }
            if (req.user && req.user.token && req.args.gist) {
                cla.getGist({
                    token: req.user.token,
                    gist: req.args.gist
                }, done);
            } else {
                var service = req.args.orgId ? orgService : repoService;
                service.get(req.args, function (err, item) {
                    if (err || !item) {
                        log.warn(new Error(err).stack, 'with args: ', req.args);
                        done(err);
                        return;
                    }
                    var gist_args = {
                        gist_url: item.gist
                    };
                    gist_args = req.args.gist ? req.args.gist : gist_args;
                    token = item.token;
                    cla.getGist({
                        token: token,
                        gist: gist_args
                    }, done);
                });
            }
        });
    },

    get: function (req, done) {
        if (!req.args || (!req.args.repo && !req.args.repoId && !req.args.orgId)) {
            log.info('args: ', req.args);
            log.info('request headers: ', req.headers);
            done('Please, provide owner and repo name or orgId');
            return;
        }
        this.getGist(req, function (err, res) {
            if (err || !res) {
                log.error(new Error(err).stack, 'with args: ', req.args);
                done(err);
                return;
            }

            var renderToken = token ? token : req.user && req.user.token ? req.user.token : token;
            renderFiles(res.files, renderToken).then(
                function success(gistContent) {
                    done(null, gistContent);
                },
                function error(msg) {
                    log.warn(new Error(msg).stack, ' Args: ', req.args);
                    done(msg);
                }
            );
        });
    },


    //Get list of signed CLAs for all repos the authenticated user has contributed to
    //Prameters: none (user should be taken)
    getSignedCLA: function (req, done) {
        cla.getSignedCLA(req.args, done);
    },

    //Get users last signature for given repository (if repo is currently linked)
    //Parameters: repo, owner (mandatory)
    getLastSignature: function (req, done) {
        var args = req.args;
        args.user = req.user.login;
        cla.getLastSignature(args, done);
    },

    //Fihnd linked item using reponame and owner as parameters
    // Params:
    // repo (mandatory)
    // owner (mandatory)
    getLinkedItem: function (req, done) {
        cla.getLinkedItem(req.args, done);
    },

    //Get all signed CLAs for given repo and gist url and/or a given gist version
    //Params:
    //	repo (mandatory)
    //	owner (mandatory)
    //	gist.gist_url (mandatory)
    //	gist.gist_version (optional)
    getAll: function (req, done) {
        cla.getAll(req.args, done);
    },

    //Get number of signed CLAs for the given repo. If no gist_version provided, the latest one will be used.
    //Params:
    //	repo (mandatory)
    //	owner (mandatory)
    //	gist.gist_url (optional)
    //	gist.gist_version (optional)
    countCLA: function (req, done) {
        var params = req.args;
        var self = this;

        function getMissingParams(cb) {
            if (params.gist && params.gist.gist_url && params.gist.gist_version && (params.repoId || params.orgId)) {
                cb();
            } else {
                self.getLinkedItem(req, function (err, item) {
                    if (err || !item) {
                        cb(err + ' There is no such item');
                        log.info(err, 'There is no such item for args: ', req.args);
                        return;
                    }
                    params.token = item.token;
                    params.sharedGist = item.sharedGist;
                    if (item.orgId) {
                        params.orgId = item.orgId;
                    } else if (item.repoId) {
                        params.repoId = item.repoId;
                    }
                    params.gist = params.gist && params.gist.gist_url ? params.gist : {
                        gist_url: item.gist
                    };
                    cla.getGist(req.args, function (e, gist) {
                        params.gist.gist_version = gist.history[0].version;
                        cb();
                    });
                });
            }
        }

        function count(err) {
            if (err) {
                done(err);
                return;
            }
            cla.getAll(params, function (err, clas) {
                done(err, clas.length);
            });
        }
        getMissingParams(count);
    },

    validateOrgPullRequests: function (req, done) {
        var self = this;
        getReposNeedToValidate(req, function (error, repos) {
            var time = config.server.github.timeToWait;
            repos.forEach(function (repo, index) {
                var validateRequest = {
                    args: {
                        owner: repo.owner.login,
                        repo: repo.name,
                        token: req.args.token || req.user.token
                    },
                    user: req.user
                };
                //try to avoid rasing githubs abuse rate limit:
                //take 1 second per repo and wait 10 seconds after each 10th repo
                setTimeout(function () {
                    log.info('validateOrgPRs for ' + validateRequest.args.owner + '/' + validateRequest.args.repo);
                    self.validatePullRequests(validateRequest);
                }, time * (index + (Math.floor(index / 10) * 10)));
            });
            if (typeof done === 'function') {
                done(error, true);
            }
        });
    },

    // Check/update status and comment of PR
    // Params:
    // repo (mandatory)
    // owner (mandatory)
    // number (mandatory)
    // sha (optional)
    // token (optional)
    validatePullRequest: function (args, done) {
        args.token = args.token ? args.token : token;
        cla.check(args, function (cla_err, all_signed, user_map) {
            if (cla_err) {
                log.error(cla_err);
            }
            args.signed = all_signed;
            if (args.gist) {
                status.update(args);
                prService.editComment({
                    repo: args.repo,
                    owner: args.owner,
                    number: args.number,
                    signed: args.signed,
                    user_map: user_map
                });
            } else {
                status.delete(args);
                prService.deleteComment({
                    repo: args.repo,
                    owner: args.owner,
                    number: args.number
                });
            }
        });
    },

    validatePullRequests: function (req, done) {
        var self = this;
        var pullRequests = [];
        var token = req.args.token ? req.args.token : req.user.token;

        function collectData(err, res, meta) {
            if (err) {
                log.error(err);
            }

            if (res && !err) {
                pullRequests = pullRequests.concat(res);
            }

            if (meta && meta.link && github.hasNextPage(meta.link)) {
                github.getNextPage(meta.link, collectData);
            } else {
                validateData(err);
            }
        }

        function validateData(err) {
            if (pullRequests.length > 0 && !err) {
                pullRequests.forEach(function (pullRequest) {
                    var status_args = {
                        repo: req.args.repo,
                        owner: req.args.owner,
                        sha: pullRequest.head.sha,
                        token: token
                    };
                    status_args.number = pullRequest.number;

                    self.validatePullRequest(status_args);
                });
            }
            if (typeof done === 'function') {
                done(err);
            }
        }

        github.call({
            obj: 'pullRequests',
            fun: 'getAll',
            arg: {
                owner: req.args.owner,
                repo: req.args.repo,
                state: 'open',
                per_page: 100
            },
            token: token
        }, collectData);
    },

    validateSharedGistItems: function (req, done) {
        var self = this;
        getLinkedItemsWithSharedGist(req.args.gist, function (error, sharedItems) {
            if (error) {
                done(error);
            }
            var items = (sharedItems.repos || []).concat(sharedItems.orgs || []);
            async.series(items.map(function (item) {
                return function (callback) {
                    var tmpReq = {
                        args: {
                            token: item.token
                        }
                    };
                    if (item.org) {
                        tmpReq.args.org = item.org;
                        return self.validateOrgPullRequests(tmpReq, callback);
                    }
                    tmpReq.args.repo = item.repo;
                    tmpReq.args.owner = item.owner;
                    self.validatePullRequests(tmpReq, callback);
                };
            }), done);
        });
    },

    sign: function (req, done) {
        var args = {
            repo: req.args.repo,
            owner: req.args.owner,
            user: req.user.login,
            userId: req.user.id,
        };
        if (req.args.custom_fields) {
            args.custom_fields = req.args.custom_fields;
        }
        var self = this;

        cla.sign(args, function (err, signed) {
            if (err) {
                log.error(err);
                return done(err);
            }
            self.validateRelatedPullRequests(req, function (validateErr) {
                if (validateErr) {
                    log.error(validateErr);
                }
                done(validateErr, signed);
            });
        });
    },

    check: function (req, done) {
        var args = {
            repo: req.args.repo,
            owner: req.args.owner,
            number: req.args.number,
            user: req.user.login
        };

        cla.check(args, done);
    },

    upload: function (req, done) {

        var users = req.args.users || [];

        async.each(users, function (user, callback) {
            github.call({
                obj: 'users',
                fun: 'getForUser',
                arg: {
                    username: user
                },
                token: req.user.token
            }, function (err, gh_user) {
                if (err || !gh_user) {
                    return callback();
                }
                cla.sign({
                    repo: req.args.repo,
                    owner: req.args.owner,
                    user: gh_user.login,
                    userId: gh_user.id
                }, callback);
            });
        }, done);
    },

    addSignature: function (req, done) {
        var self = this;
        var schema = Joi.object().keys({
            user: Joi.string().required(),
            userId: Joi.number().required(),
            org: Joi.string(),
            owner: Joi.string(),
            repo: Joi.string(),
            custom_fields: Joi.string(),
            validatePRs: Joi.boolean()
        }).and('repo', 'owner').xor('repo', 'org');
        Joi.validate(req.args, schema, { abortEarly: false, convert: false }, function (joiErr) {
            if (joiErr) {
                return done(joiErr);
            }
            req.args.owner = req.args.owner || req.args.org;
            delete req.args.org;
            cla.sign(req.args, function (err, signed) {
                if (err) {
                    log.error(err);
                    return done(err);
                }
                if (!req.args.validatePRs) {
                    return done(null, signed);
                }
                self.validateRelatedPullRequests(req, function (validateErr) {
                    if (validateErr) {
                        log.error(validateErr);
                    }
                    done(validateErr, signed);
                });
            });
        });
    },

    hasSignature: function (req, done) {
        var argsScheme = Joi.object().keys({
            user: Joi.string().required(),
            userId: Joi.number().required(),
            org: Joi.string(),
            owner: Joi.string(),
            repo: Joi.string(),
            number: Joi.string()
        }).and('repo', 'owner').xor('repo', 'org');
        Joi.validate(req.args, argsScheme, { abortEarly: false, convert: false }, function (joiErr) {
            if (joiErr) {
                return done(joiErr);
            }
            req.args.owner = req.args.owner || req.args.org;
            delete req.args.org;
            cla.check(req.args, done);
        });
    },

    terminateSignature: function (req, done) {
        var self = this;
        var schema = Joi.object().keys({
            user: Joi.string().required(),
            userId: Joi.number().required(),
            endDate: Joi.string().isoDate().required(),
            org: Joi.string(),
            owner: Joi.string(),
            repo: Joi.string(),
            validatePRs: Joi.boolean()
        }).and('repo', 'owner').xor('repo', 'org');
        Joi.validate(req.args, schema, { abortEarly: false, convert: false }, function (joiErr) {
            if (joiErr) {
                return done(joiErr);
            }
            req.args.owner = req.args.owner || req.args.org;
            delete req.args.org;
            cla.terminate(req.args, function (err, dbCla) {
                if (err) {
                    log.error(err);
                    return done(err);
                }
                if (!req.args.validatePRs) {
                    return done(null, dbCla);
                }
                self.validateRelatedPullRequests(req, function (validateErr) {
                    if (validateErr) {
                        log.error(validateErr);
                    }
                    done(validateErr, dbCla);
                });
            });
        });
    },

    validateRelatedPullRequests: function (req, done) {
        var self = this;
        self.getLinkedItem({
            args: {
                repo: req.args.repo,
                owner: req.args.owner
            }
        }, function (error, item) {
            if (error) {
                return done(error);
            }
            req.args.token = item.token;
            req.args.gist = item.gist;
            if (item.sharedGist) {
                self.validateSharedGistItems(req, function (err) {
                    if (err) {
                        log.error(err);
                    }
                });
            } else if (item.org) {
                req.args.org = item.org;
                self.validateOrgPullRequests(req);
            } else {
                self.validatePullRequests(req);
            }
            done(null);
        });
    },

    validate: function (req, done) {
        var self = this;
        var schema = Joi.object().keys({
            org: Joi.string(),
            owner: Joi.string(),
            repo: Joi.string(),
        }).and('repo', 'owner').xor('repo', 'org');
        Joi.validate(req.args, schema, { abortEarly: false, convert: false, allowUnknown: true }, function (joiErr) {
            if (joiErr) {
                return done(joiErr);
            }
            req.args.owner = req.args.owner || req.args.org;
            delete req.args.org;
            self.validateRelatedPullRequests(req, done);
        });
    }

    // updateDBData: function (req, done) {
    //     // repoService.updateDBData(req, function(){
    //         cla.updateDBData(req, function(msg){
    //             done(null, msg);
    //         });
    //     // });
    // }
};