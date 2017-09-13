var PullRequest = require('mongoose').model('PullRequest');

module.exports = {
    storePullRequest: function (req, done) {
        var pr = this.generatePullRequest(req);
        PullRequest.create(pr, done);
    },

    removePullRequest: function (req, done) {
        var pr = this.generatePullRequest(req);
        var query = {
            userId: pr.userId,
            repoId: pr.repoId,
            number: pr.number
        };
        PullRequest.remove(query, done);
    },

    generatePullRequest: function (req) {
        return {
            repoId: req.args.repository.id,
            owner: req.args.repository.owner.login,
            repo: req.args.repository.name,
            number: req.args.number.toString(),
            user: req.args.pull_request.user.login,
            userId: req.args.pull_request.user.id.toString(),
            created_at: req.args.pull_request.created_at
        };
    }
};