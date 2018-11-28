require('../documents/repo');
let mongoose = require('mongoose');
let Repo = mongoose.model('Repo');
let _ = require('lodash');
let async = require('async');

//services
let github = require('../services/github');
let logger = require('../services/logger');
let orgService = require('../services/org');

//queries
let queries = require('../graphQueries/github');

//services
let url = require('../services/url');

let isTransferredRenamed = function (dbRepo, ghRepo) {
    return ghRepo.repoId == dbRepo.repoId && (ghRepo.repo !== dbRepo.repo || ghRepo.owner !== dbRepo.owner);
};

let compareRepoNameAndUpdate = function (dbRepo, ghRepo) {
    if (isTransferredRenamed(dbRepo, ghRepo)) {
        dbRepo.owner = ghRepo.owner;
        dbRepo.repo = ghRepo.repo;
        dbRepo.save();

        return true;
    }

    return false;
};

let compareAllRepos = function (ghRepos, dbRepos, done) {
    dbRepos.forEach(function (dbRepo) {
        ghRepos.some(function (ghRepo) {
            return compareRepoNameAndUpdate(dbRepo, ghRepo);
        });
    });
    done();
};

let extractUserFromCommit = function (commit) {
    let committer = commit.author.user || commit.committer.user || commit.author || commit.committer;

    return committer;
};

let selection = function (args) {
    return args.repoId ? {
        repoId: args.repoId
    } : {
            repo: args.repo,
            owner: args.owner
        };
};

module.exports = {
    timesToRetryGitHubCall: 30,
    all: function (done) {
        this._find({}, function (err, repos) {
            done(err, repos);
        });
    },

    check: function (args, done) {
        this._findOne(selection(args), function (err, repo) {
            done(err, !!repo);
        });
    },
    create: function (args, done) {
        this._create({
            repo: args.repo,
            owner: args.owner,
            repoId: args.repoId,
            gist: args.gist,
            token: args.token,
            sharedGist: !!args.sharedGist,
            minFileChanges: args.minFileChanges,
            minCodeChanges: args.minCodeChanges
        }, function (err, repo) {
            done(err, repo);
        });
    },
    get: function (args, done) {
        this._findOne(selection(args), function (err, repo) {
            if (!err && !repo) {
                err = 'Repository not found in Database';
            }
            done(err, repo);
        });
    },
    getAll: function (args, done) {
        let repoIds = [];
        args.set.forEach(function (repo) {
            repoIds.push({
                repoId: repo.repoId
            });
        });
        let idChunk = _.chunk(repoIds, 100);
        async.parallelLimit(idChunk.map((chunk) => {
            return (callback) => {
                this._find({
                    $or: chunk
                }, callback);
            };
        }), 3, function (err, repoChunk) {
            if (err) {
                return done(err);
            }
            let repos = _.concat.apply(null, repoChunk);
            done(null, repos);
        });
    },

    getByOwner: function (owner, done) {
        this._find({
            owner: owner
        }, done);
    },

    getRepoWithSharedGist: function (gist, done) {
        this._find({ gist: gist, sharedGist: true }, done);
    },

    update: function (args, done) {
        let repoArgs = {
            repo: args.repo,
            owner: args.owner
        };
        this._findOne(repoArgs, function (err, repo) {
            if (err) {
                done(err);

                return;
            }
            repo.repoId = args.repoId;
            repo.gist = args.gist;
            repo.save(done);
        });
    },
    remove: function (args, done) {
        Repo.findOneAndRemove(selection(args), done);
    },

    getPRCommitters: function (args, done) {
        let self = this;

        let handleError = function (err, message, a) {
            logger.warn(err);
            if (!a.count) {
                logger.info('getPRCommitters with arg: ', a);
            }
            done(message);
        };

        let callGithub = function (arg, linkedItem) {
            let committers = [];
            let linkedRepo = linkedItem && linkedItem.repoId ? linkedItem : undefined;

            let query = arg.query ? arg.query : queries.getPRCommitters(arg.arg.owner, arg.arg.repo, arg.arg.number, '');

            github.callGraphql(query, arg.token, function (err, res, body) {
                if (err || res.statusCode > 200) {
                    let msg = 'No result on GH call, getting PR committers!' + err;
                    handleError(new Error(msg).stack, msg, { owner: arg.arg.owner, repo: arg.arg.repo, number: arg.arg.number });

                    return;
                }
                if (res && !res.message) {
                    body = JSON.parse(body);
                    let data = body.data;

                    if (body.errors) {
                        logger.info(new Error(body.errors[0].message).stack);
                    }
                    if (!data || !data.repository || !data.repository.pullRequest || !data.repository.pullRequest.commits || !data.repository.pullRequest.commits.edges) {
                        done('No committers found');

                        return;
                    }
                    data.repository.pullRequest.commits.edges.forEach((edge) => {
                        try {
                            let committer = extractUserFromCommit(edge.node.commit);
                            let user = {
                                name: committer.login || committer.name,
                                id: committer.databaseId || ''
                            };
                            if (committers.length === 0 || committers.map(function (c) {
                                return c.name;
                            }).indexOf(user.name) < 0) {
                                committers.push(user);
                            }
                        } catch (error) {
                            let msg = 'Problem on PR ' + url.githubPullRequest(arg.owner, arg.repo, arg.number) + 'commit info seems to be wrong; ' + error;
                            handleError(new Error(msg).stack, msg, { owner: arg.arg.owner, repo: arg.arg.repo, number: arg.arg.number });
                        }
                    });

                    if (data.repository.pullRequest.commits.pageInfo.hasNextPage) {
                        arg.query = queries.getPRCommitters(arg.arg.owner, arg.arg.repo, arg.arg.number, data.repository.pullRequest.commits.pageInfo.endCursor);
                        callGithub(arg, linkedItem);
                    } else {
                        done(null, committers);
                    }
                } else if (res.message) {
                    if (res && res.message === 'Moved Permanently' && linkedRepo) {
                        self.getGHRepo(args, function (err, res) {
                            if (res && res.id && compareRepoNameAndUpdate(linkedRepo, {
                                repo: res.name,
                                owner: res.owner.login,
                                repoId: res.id
                            })) {
                                arg.arg.repo = res.name;
                                arg.arg.owner = res.owner.login;

                                callGithub(arg);
                            } else {
                                let msg = 'Moved Permanently ' + err;
                                handleError(new Error(msg).stack, msg, { owner: arg.arg.owner, repo: arg.arg.repo, number: arg.arg.number });
                            }
                        });
                    } else {
                        handleError(new Error(res.message).stack, res.message, { owner: arg.arg.owner, repo: arg.arg.repo, number: arg.arg.number });
                        // if (!arg.count && self.timesToRetryGitHubCall && self.timesToRetryGitHubCall > 0) {
                        //     arg.count = self.timesToRetryGitHubCall;
                        //     setTimeout(function () {
                        //         callGithub(arg, linkedItem);
                        //     }, 1000 * self.timesToRetryGitHubCall);
                        //     return;
                        // } else {
                        //     done(res.message);
                        // }
                    }
                }

            });
        };

        let collectTokenAndCallGithub = function (args, item) {
            args.token = item.token;
            let params = {
                arg: {
                    owner: args.owner,
                    repo: args.repo,
                    number: args.number,
                    per_page: 100
                },
                token: args.token
            };
            callGithub(params, item);

        };

        self.get(args, function (error, repo) {
            if (!repo) {
                orgService.get({
                    orgId: args.orgId
                }, function (err, org) {
                    if (!org) {
                        return handleError(new Error(error).stack, error, { owner: args.owner, repo: args.repo, repoId: args.repoId, orgId: args.orgId, number: args.number });
                    }
                    if (err) {
                        logger.warn(err);
                    }
                    collectTokenAndCallGithub(args, org);
                });
            } else {
                collectTokenAndCallGithub(args, repo);
            }
        });
    },

    getUserRepos: function (args, done) {
        let that = this;
        let affiliation = args.affiliation ? args.affiliation : 'owner,organization_member';
        github.call({
            obj: 'repos',
            fun: 'getAll',
            arg: {
                affiliation: affiliation,
                per_page: 100
            },
            token: args.token
        }, function (err, res) {
            if (!res || res.length < 1 || res.message) {
                err = res && res.message ? res.message : err;
                done(err, null);

                return;
            }

            let repoSet = [];
            res.forEach(function (githubRepo) {
                if (githubRepo.permissions.push) {
                    repoSet.push({
                        owner: githubRepo.owner.login,
                        repo: githubRepo.name,
                        repoId: githubRepo.id
                    });
                }
            });
            that.getAll({
                set: repoSet
            }, function (err, dbRepos) {
                if (dbRepos) {
                    compareAllRepos(repoSet, dbRepos, function () {
                        done(err, dbRepos);
                    });
                } else {
                    done(err);
                }
            });
        });
    },

    // updateDBData: function(req, done) {
    //     let self = this;
    //     Repo.find({}, function(error, dbRepos){
    //         dbRepos.forEach(function(dbRepo){
    //             let params = {
    //                 url: url.githubRepository(dbRepo.owner, dbRepo.repo),
    //                 token: req.user.token
    //             };
    //             github.direct_call(params, function(err, ghRepo){
    //                 if (ghRepo && ghRepo && ghRepo.id) {
    //                     dbRepo.repoId = ghRepo.id;
    //                     dbRepo.save();
    //                 } else if (ghRepo && ghRepo && ghRepo.message) {
    //                     logger.info(ghRepo.message, 'with params ', params);
    //                 }
    //             });
    //         });
    //         done();
    //     });
    // },

    getGHRepo: function (args, done) {
        let params = {
            obj: 'repos',
            fun: 'get',
            arg: {
                owner: args.owner,
                repo: args.repo
            },
            token: args.token
        };
        github.call(params, done);
    },

    _find: (query, done) => {
        Repo.find(query, (err, repos) => {
            if (err) return done(err);
            if (config.server.github.adminToken) {
                return done(null, repos.map(repo => {
                    repo.token = config.server.github.adminToken;
                    return repo;
                }));
            }
            return done(null, repos);
        });
    },

    _findOne: (query, done) => {
        Repo.findOne(query, (err, repo) => {
            if (err) return done(err);
            if (repo && config.server.github.adminToken) {
                repo.token = config.server.github.adminToken;
            }
            return done(null, repo);
        });
    },

    _create: (repo, done) => {
        if (config.server.github.adminToken) {
            delete repo.token;
        }
        Repo.create(repo, function (err, repo) {
            done(err, repo);
        });
    }
};