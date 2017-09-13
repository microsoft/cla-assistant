// services
var pullRequest = require('../services/pullRequest');
var status = require('../services/status');
var cla = require('../services/cla');
var repoService = require('../services/repo');
var orgService = require('../services/org');
var log = require('../services/logger');
var config = require('../../config');
var prStore = require('../services/pullRequestStore');

//////////////////////////////////////////////////////////////////////////////////////////////
// Github Pull Request Webhook Handler
//////////////////////////////////////////////////////////////////////////////////////////////

function updateStatusAndComment(args) {
    repoService.getPRCommitters(args, function (err, committers) {
        if (!err && committers && committers.length > 0) {
            cla.check(args, function (error, signed, user_map) {
                if (error) {
                    log.warn(new Error(error).stack);
                }
                args.signed = signed;
                status.update(args);
                if (config.server.feature_flag.close_comment === 'true' && signed) {
                    return;
                }
                pullRequest.badgeComment(
                    args.owner,
                    args.repo,
                    args.number,
                    signed,
                    user_map
                );
            });
        } else {
            if (!args.handleCount || args.handleCount < 2) {
                args.handleCount = args.handleCount ? ++args.handleCount : 1;
                setTimeout(function () {
                    updateStatusAndComment(args);
                }, 10000 * args.handleCount * args.handleDelay);
            } else {
                log.warn(new Error(err).stack, 'PR committers: ', committers, 'called with args: ', args);
            }
        }
    });
};

function handleWebHook(args) {
    cla.isClaRequired(args, function (error, isClaRequired) {
        if (error) {
            return log.error(error);
        }
        if (!isClaRequired) {
            status.updateForClaNotRequired(args);
            pullRequest.deleteComment({
                repo: args.repo,
                owner: args.owner,
                number: args.number
            });
            return;
        }
        updateStatusAndComment(args);
    });
}

function managePullRequestStore(req, done) {
    if (req.args.repository && req.args.repository.private) {
        return done();
    }
    var handleEvents = ['opened', 'reopened', 'closed'];
    if (handleEvents.indexOf(req.args.action) === -1) {
        return done();
    }
    var pr = prStore.generatePullRequest(req);
    cla.getLinkedItem({ repo: pr.repo, owner: pr.owner }, function (err, item) {
        if (err) {
            return done(err);
        }
        if (!item.gist) {
            return done();
        }
        if (req.args.action === 'opened' || req.args.action === 'reopened') {
            return prStore.storePullRequest(req, done);
        }
        if (req.args.action === 'closed') {
            return prStore.removePullRequest(req, done);
        }
    });
}

module.exports = function (req, res) {
    if (['opened', 'reopened', 'synchronize'].indexOf(req.args.action) > -1 && (req.args.repository && req.args.repository.private == false)) {
        if (req.args.pull_request && req.args.pull_request.html_url) {
            console.log('pull request ' + req.args.action + ' ' + req.args.pull_request.html_url);
        }
        var args = {
            owner: req.args.repository.owner.login,
            repoId: req.args.repository.id,
            repo: req.args.repository.name,
            number: req.args.number
        };
        args.orgId = req.args.organization ? req.args.organization.id : req.args.repository.owner.id;
        args.handleDelay = req.args.handleDelay != undefined ? req.args.handleDelay : 1; // needed for unitTests


        setTimeout(function () {
            repoService.get(args, function (e, repo) {
                if (repo) {
                    if (!repo.gist) {
                        return;
                    }
                    args.orgId = undefined;
                    args.token = repo.token;
                    args.gist = repo.gist; //TODO: Test it!!
                    handleWebHook(args);
                } else {
                    orgService.get({
                        orgId: args.orgId
                    }, function (err, org) {
                        if (org) {
                            args.token = org.token;
                            args.gist = org.gist; //TODO: Test it!!
                            if (!org.isRepoExcluded(args.repo)) {
                                repoService.getGHRepo(args, function (err, repo) {
                                    if (repo) {
                                        handleWebHook(args);
                                    }
                                });
                            }
                        }
                    });
                }
            });
        }, config.server.github.enforceDelay);
    }

    managePullRequestStore(req, function (err) {
        if (err) {
            var pr = prStore.generatePullRequest(req);
            log.error({ err: err, pullRequest: pr });
        }
    });

    res.status(200).send('OK');
};