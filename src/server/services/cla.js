// models
require('../documents/cla');
// require('../documents/user');
var https = require('https');
var q = require('q');
var CLA = require('mongoose').model('CLA');

//services
var logger = require('../services/logger');
var orgService = require('../services/org');
var repoService = require('../services/repo');
var config = require('../../config');
var github = require('./github');

module.exports = function () {
    var claService;

    var getGistObject = function (gist_url, gist_version, token) {
        var deferred = q.defer();
        try {
            var gistArray = gist_url.split('/'); // https://gist.github.com/KharitonOff/60e9b5d7ce65ca474c29
            var id = gistArray[gistArray.length - 1];
        } catch (ex) {
            deferred.reject('The gist url "' + gist_url + '" seems to be invalid');
            return deferred.promise;
        }
        var path = '/gists/' + id;

        path += gist_version ? '/' + gist_version : '';

        var req = {};
        var data = '';
        var options = {
            hostname: config.server.github.api,
            port: 443,
            path: path,
            method: 'GET',
            headers: {
                'Authorization': 'token ' + token,
                'User-Agent': 'cla-assistant'
            }
        };

        req = https.request(options, function (res) {
            res.on('data', function (chunk) {
                data += chunk;
            });
            res.on('end', function () {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    logger.warn(new Error(e).stack);
                }
                deferred.resolve(data);
            });
        });

        req.end();
        req.on('error', function (e) {
            deferred.reject(e);
        });
        return deferred.promise;
    };

    var getGist = function (gist_url, token) {
        var gistArray = gist_url.split('/');
        var id = gistArray[gistArray.length - 1];
        return github.call({
            obj: 'gists',
            fun: 'get',
            arg: {
                id: id
            },
            token: token
        }).then(function (gist) {
            if (gist.data.message) {
                throw new Error(gist.data.message);
            }
            return gist;
        });
    };

    var checkAll = function (users, repoId, orgId, sharedGist, gist_url, gist_version, onDates) {
        var deferred = q.defer();
        var all_signed = true;
        var promises = [];
        var user_map = {
            signed: [],
            not_signed: [],
            unknown: []
        };
        if (!users) {
            deferred.reject('There are no users to check :( ', users, repoId, orgId, sharedGist, gist_url, gist_version, onDates);
            return deferred.promise;
        }
        users.forEach(function (user) {
            user_map.not_signed.push(user.name);
            if (!user.id) {
                user_map.unknown.push(user.name);
            }
            promises.push(getLastSignatureOnMultiDates(user.name, user.id, repoId, orgId, sharedGist, gist_url, gist_version, onDates).then(function (cla) {
                if (!cla) {
                    all_signed = false;
                } else {
                    var i = user_map.not_signed.indexOf(cla.user);
                    if (i >= 0) {
                        user_map.not_signed.splice(i, 1);
                    }
                    user_map.signed.push(cla.user);
                }
            }));
        });
        q.all(promises).then(function () {
            deferred.resolve({
                signed: all_signed,
                user_map: user_map
            });
        });
        return deferred.promise;
    };

    var generateSharedGistQuery = function (gist_url, gist_version, user, userId) {
        var sharedGistCondition = {
            owner: undefined,
            repo: undefined,
            gist_url: gist_url,
        };
        if (gist_version) {
            sharedGistCondition.gist_version = gist_version;
        }
        if (user) {
            sharedGistCondition.user = user;
        }
        if (userId) {
            sharedGistCondition.userId = userId;
        }
        return sharedGistCondition;
    };

    var generateDateConditions = function (onDates) {
        var dateConditions = [];
        if (!Array.isArray(onDates) || onDates.length === 0) {
            return dateConditions;
        }
        onDates.forEach(function (date) {
            dateConditions = dateConditions.concat([{
                created_at: { $lte: date },
                end_at: { $gt: date }
            }, {
                created_at: { $lte: date },
                end_at: undefined
            }]);
        });
        return dateConditions;
    };

    var updateQuery = function (query, sharedGist, onDates) {
        var queries = [query];
        if (sharedGist) {
            var shardGistQuery = generateSharedGistQuery(query.gist_url, query.gist_version, query.user, query.userId);
            queries.push(shardGistQuery);
        }
        var dateConditions = generateDateConditions(onDates);
        var newQuery = {
            $or: []
        };
        if (dateConditions.length === 0) {
            newQuery.$or = queries;
            return newQuery;
        };
        queries.forEach(function (query) {
            dateConditions.forEach(function (date) {
                newQuery.$or.push(Object.assign({}, query, date));
            });
        });
        return newQuery;
    };

    var getPR = function (owner, repo, number, token) {
        var deferred = q.defer();
        github.call({
            obj: 'pullRequests',
            fun: 'get',
            arg: {
                owner: owner,
                repo: repo,
                number: number
            },
            token: token
        }, function (error, pullRequest) {
            if (error) {
                return deferred.reject(error);
            }
            deferred.resolve(pullRequest);
        });
        return deferred.promise;
    };

    // var getOrg = function (args, done) {
    //     var deferred = q.defer();
    //     orgService.get(args, function (err, org) {
    //         if (!err && org) {
    //             deferred.resolve(org);
    //         } else {
    //             deferred.reject(err);
    //         }
    //         if (typeof done === 'function') {
    //             done(err, org);
    //         }
    //     });
    //     return deferred.promise;
    // };

    var getRepo = function (args, done) {
        var deferred = q.defer();
        repoService.get(args, function (err, repo) {
            if (!err && repo) {
                deferred.resolve(repo);
            } else {
                deferred.reject(err);
            }
            if (typeof done === 'function') {
                done(err, repo);
            }
        });
        return deferred.promise;
    };

    var getLinkedItem = function (repo, owner, token) {
        var deferred = q.defer();
        token = token || config.server.github.token;

        if (owner && !repo) {
            orgService.get({
                org: owner
            }, function (err, linkedOrg) {
                if (linkedOrg) {
                    deferred.resolve(linkedOrg);
                } else {
                    deferred.reject(err);
                }
            });
        } else {
            repoService.getGHRepo({
                owner: owner,
                repo: repo,
                token: token
            }, function (e, ghRepo) {
                if (e) {
                    // could not find the GH Repo
                    deferred.reject(e);
                } else {
                    repoService.get({
                        repoId: ghRepo.id
                    }, function (error, linkedRepo) {
                        if (linkedRepo) {
                            deferred.resolve(linkedRepo);
                        } else {
                            orgService.get({
                                orgId: ghRepo.owner.id
                            }, function (err, linkedOrg) {
                                if (linkedOrg) {
                                    deferred.resolve(linkedOrg);
                                } else {
                                    deferred.reject(error || err);
                                }
                            });
                        }
                    });
                }
            });
        }
        return deferred.promise;
    };

    var getLastSignatureOnMultiDates = function (user, userId, repoId, orgId, sharedGist, gist_url, gist_version, date) {
        if (!user || (!repoId && !orgId) || sharedGist === undefined || !gist_url || (date && !Array.isArray(date))) {
            throw new Error('Not provide enough arguments for getSignature()');
        }
        var deferred = q.defer();
        var query = {
            user: user,
            gist_url: gist_url,
            org_cla: !!orgId
        };
        if (repoId) {
            query.repoId = repoId;
        }
        if (orgId) {
            query.ownerId = orgId;
        }
        if (userId) {
            query.userId = userId;
        }
        if (gist_version) {
            query.gist_version = gist_version;
        }
        query = updateQuery(query, sharedGist, date);
        CLA.findOne(query, {}, {
            sort: {
                'created_at': -1
            }
        }, function (error, cla) {
            if (error) {
                return deferred.reject(error);
            }
            deferred.resolve(cla);
        });
        return deferred.promise;
    };

    var getPullRequestFiles = function (repo, owner, number, token) {
        return github.call({
            obj: 'pullRequests',
            fun: 'getFiles',
            arg: {
                repo: repo,
                owner: owner,
                number: number,
            },
            token: token
        }).then(function (resp) {
            return resp.data;
        });
    };

    var isSignificantPullRequest = function (repo, owner, number, token) {
        if (!repo || !owner || !number || !token) {
            return q.reject(Error('There are NOT enough arguments for isSignificantPullRequest.'));
        }
        return getLinkedItem(repo, owner, token).then(function (item) {
            if (typeof item.minFileChanges !== 'number' && typeof item.minCodeChanges !== 'number') {
                return true;
            }
            return getPullRequestFiles(repo, owner, number, token).then(function (files) {
                if (typeof item.minFileChanges === 'number' && files.length >= item.minFileChanges) {
                    return true;
                }
                if (typeof item.minCodeChanges === 'number') {
                    var sum = 0;
                    return files.some(function (file) {
                        sum += file.changes;
                        return sum >= item.minCodeChanges;
                    });
                }
                return false;
            });
        });
    };

    claService = {
        getGist: function (args, done) {
            var gist_url = args.gist ? args.gist.gist_url || args.gist.url || args.gist : undefined;
            var gist_version = args.gist ? args.gist.gist_version : undefined;

            getGistObject(gist_url, gist_version, args.token).then(function (gistObj) {
                done(null, gistObj);
            }, function (err) {
                done(err);
            });
        },

        /**
         * Get the last signature of the current version cla at current moment or at a pull request moment
         * Params:
         *   user (mandatory)
         *   owner (mandatory)
         *   repo (optional)
         *   number (optional)
         */
        getLastSignature: function (args, done) {
            return getLinkedItem(args.repo, args.owner).then(function (item) {
                args.gist = item.gist;
                if (!item.gist) {
                    return 'null-cla';
                }
                return getGist(args.gist, item.token).then(function (gist) {
                    args.gist_version = gist.data.history[0].version;
                    args.onDates = [new Date()];
                    if (args.number) {
                        return getPR(args.owner, args.repo, args.number, item.token).then(function (pullRequest) {
                            args.onDates.push(new Date(pullRequest.created_at));
                            return args;
                        });
                    }
                    return args;
                }).then(function (args) {
                    return getLastSignatureOnMultiDates(args.user, args.userId, item.repoId, item.orgId, item.sharedGist, item.gist, args.gist_version, args.onDates).then(function (cla) {
                        return cla;
                    });
                });
            }).then(function (cla) {
                return done(null, cla);
            }).catch(function (error) {
                return done(error);
            });
        },

        /**
         * Check whether a user signed the current cla at current moment or at the pull request moment.
         * Params:
         *   user (mandatory)
         *   owner (mandatory)
         *   repo (optional)
         *   number (optional)
         */
        checkUserSignature: function (args, done) {
            var self = this;
            return self.getLastSignature(args, function (error, cla) {
                done(error, { signed: !!cla });
            });
        },

        /**
         * Check whether all committers signed the current cla at current moment or at the pull request moment.
         * Params:
         *   user (mandatory)
         *   number (mandatory)
         *   owner (mandatory)
         *   repo (optional)
         */
        checkPullRequestSignatures: function (args, done) {
            getLinkedItem(args.repo, args.owner, args.token).then(function (item) {
                args.gist = item.gist;
                args.repoId = item.repoId;
                args.orgId = item.orgId;
                args.onDates = [new Date()];
                if (!args.gist) {
                    return done(null, {
                        signed: true
                    });
                }
                return getGist(args.gist, item.token).then(function (gist) {
                    args.gist_version = gist.data.history[0].version;
                    return getPR(args.owner, args.repo, args.number, item.token).then(function (pullRequest) {
                        args.onDates.push(new Date(pullRequest.created_at));
                        repoService.getPRCommitters(args, function (error, committers) {
                            if (error) {
                                logger.warn(new Error(error).stack);
                            }
                            return checkAll(committers, item.repoId, item.orgId, item.sharedGist, item.gist, args.gist_version, args.onDates).then(function (result) {
                                done(null, result);
                            }).catch(function (err) {
                                done(err);
                            });
                        });
                    });
                });
            }).catch(function (er) {
                done(er);
            });
        },

        check: function (args, done) {
            var self = this;
            if (args.user) {
                return self.checkUserSignature(args, function (error, result) {
                    done(error, result.signed);
                });
            } else if (args.number) {
                return self.checkPullRequestSignatures(args, function (error, result) {
                    done(error, result.signed, result.user_map);
                });
            } else {
                return done('A user or a pull request number is required.');
            }
        },

        sign: function (args, done) {
            var self = this;
            return getLinkedItem(args.repo, args.owner, args.token).then(function (item) {
                if (!item.gist) {
                    var nullClaErr = new Error('The repository don\'t need to sign a CLA because it has a null CLA.');
                    nullClaErr.code = 400;
                    throw nullClaErr;
                }
                return getGist(item.gist, item.token).then(function (gist) {
                    var onDates = [new Date()];
                    var currentVersion = gist.data.history[0].version;
                    return getLastSignatureOnMultiDates(args.user, args.userId, item.repoId, item.orgId, item.sharedGist, item.gist, currentVersion, onDates).then(function (cla) {
                        if (cla) {
                            var signedErr = new Error('You\'ve already signed the cla');
                            signedErr.code = 400;
                            throw signedErr;
                        }
                        var argsToCreate = {
                            user: args.user,
                            userId: args.userId,
                            gist: item.gist,
                            gist_version: currentVersion,
                            custom_fields: args.custom_fields
                        };
                        if (!item.sharedGist) {
                            argsToCreate.ownerId = item.orgId;
                            argsToCreate.repoId = item.repoId;
                            argsToCreate.org_cla = !!item.orgId;
                            argsToCreate.owner = item.owner || item.org;
                            argsToCreate.repo = item.repo;
                        }
                        self.create(argsToCreate, function (error) {
                            done(error, 'done');
                        });
                    });
                });
            }).catch(function (error) {
                done(error);
            });
        },

        //Get list of signed CLAs for all repos the user has contributed to
        getSignedCLA: function (args, done) {
            var selector = [];
            var findCla = function (query, repoList, claList, cb) {
                CLA.find(query, {
                    'repo': '*',
                    'owner': '*',
                    'created_at': '*',
                    'gist_url': '*',
                    'gist_version': '*'
                }, {
                    sort: {
                        'created_at': -1
                    }
                }, function (err, clas) {
                    if (err) {
                        logger.warn(new Error(err).stack);
                    } else {
                        clas.forEach(function (cla) {
                            if (repoList.indexOf(cla.repo) < 0) {
                                repoList.push(cla.repo);
                                claList.push(cla);
                            }
                        });
                    }
                    cb();
                });
            };

            repoService.all(function (e, repos) {
                if (e) {
                    logger.warn(new Error(e).stack);
                }
                repos.forEach(function (repo) {
                    selector.push({
                        user: args.user,
                        repo: repo.repo,
                        gist_url: repo.gist
                    });
                });
                var repoList = [];
                var uniqueClaList = [];
                findCla({
                    $or: selector
                }, repoList, uniqueClaList, function () {
                    findCla({
                        user: args.user
                    }, repoList, uniqueClaList, function () {
                        done(null, uniqueClaList);
                    });
                });
            });
        },

        // Get linked repo or org
        // Params:
        // repo (mandatory)
        // owner (mandatory)
        // token (optional)
        getLinkedItem: function (args, done) {
            getLinkedItem(args.repo, args.owner, args.token).then(
                function (item) {
                    done(null, item);
                },
                function (err) {
                    done(err);
                }
            );
        },

        // updateDBData: function(req, done){
        //     logger.info(req.user);
        //     CLA.find({}, function(err, clas){
        //         if (!err && clas) {
        //             clas.forEach(function(cla){
        //                 // repoService.getGHRepo({owner: cla.owner, repo: cla.repo, token: req.user.token}, function(e, ghRepo){
        //                 //     if (ghRepo && ghRepo.id) {
        //                 //         cla.repoId = ghRepo.id;
        //                 //         if (cla.owner !== ghRepo.owner.login || cla.repo !== ghRepo.name) {
        //                 //             logger.info(ghRepo.full_name, ' != ', cla.owner, '/', cla.repo);
        //                 //             cla.owner = ghRepo.owner.login;
        //                 //             cla.repo = ghRepo.name;
        //                 //             logger.info('transfered to ', cla.owner, '/', cla.repo, 'id:', cla.repoId);
        //                 //         }
        //                 //         cla.save();
        //                 //     }
        //                 // });
        //                 if (!cla.org_cla) {
        //                     cla.org_cla = false;
        //                     cla.save(function (err, cla) {
        //                         if (err){
        //                             logger.info('Failed to update cla ', cla, err);
        //                         }
        //                     });
        //                 }
        //             });
        //             done('updating ' + clas.length + ' CLAs...');
        //         } else {
        //             done(err);
        //         }
        //     });
        // },

        //Get all signed CLAs for given repo and gist url and/or a given gist version
        //Params:
        //	repoId (mandatory) or
        //	orgId (mandatory) and
        //	gist.gist_url (mandatory)
        //	gist.gist_version (optional)
        getAll: function (args, done) {
            if (!args.gist || !args.gist.gist_url || (!args.repoId && !args.orgId)) {
                done('Wrong arguments, gist url or repo id are missing');
                return;
            }
            var selection = {
                gist_url: args.gist.gist_url
            };
            if (args.gist.gist_version) {
                selection.gist_version = args.gist.gist_version;
            }
            if (args.repoId) {
                selection.repoId = args.repoId;
            }
            if (args.orgId) {
                selection.ownerId = args.orgId;
            }
            selection = updateQuery(selection, args.sharedGist);
            CLA.find(selection, {}, {
                sort: {
                    user: 1,
                    userId: 1
                }
            }, done);
        },

        create: function (args, done) {
            var now = new Date();

            CLA.create({
                repo: args.repo,
                repoId: args.repoId,
                owner: args.owner,
                ownerId: args.ownerId,
                user: args.user,
                userId: args.userId,
                gist_url: args.gist,
                gist_version: args.gist_version,
                created_at: now,
                end_at: undefined,
                org_cla: args.org_cla,
                custom_fields: args.custom_fields
            }, function (err, res) {
                done(err, res);
            });
        },

        terminate: function (args, done) {
            return getLinkedItem(args.repo, args.owner, args.token).then(function (item) {
                if (!item.gist) {
                    var nullClaErr = new Error('The repository don\'t need to sign a CLA because it has a null CLA.');
                    nullClaErr.code = 400;
                    throw nullClaErr;
                }
                return getGist(item.gist, item.token).then(function (gist) {
                    var endDate = new Date(args.endDate);
                    var onDates = [endDate];
                    var currentVersion = gist.data.history[0].version;
                    return getLastSignatureOnMultiDates(args.user, args.userId, item.repoId, item.orgId, item.sharedGist, item.gist, currentVersion, onDates).then(function (cla) {
                        if (!cla) {
                            var noRecordErr = new Error('No valid cla record');
                            noRecordErr.code = 400;
                            throw noRecordErr;
                        }
                        cla.end_at = endDate;
                        return cla.save().then(function (dbCla) {
                            done(null, dbCla);
                        });
                    });
                });
            }).catch(function (error) {
                done(error);
            });
        },

        isClaRequired: function (args, done) {
            return isSignificantPullRequest(args.repo, args.owner, args.number, args.token).then(function (isSignificant) {
                done(null, isSignificant);
            }).catch(done);
        }
    };
    return claService;
}();
