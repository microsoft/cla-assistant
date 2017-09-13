var mongoose = require('mongoose');
mongoose.Promise = require('q').Promise;

var pullRequestSchema = mongoose.Schema({
    repoId: String,
    owner: String,
    repo: String,
    number: String,
    user: String,
    userId: String,
    created_at: String
});

pullRequestSchema.index({
    userId: 1,
    repoId: 1,
    number: 1
}, {
    unique: true
});

var PullRequest = mongoose.model('PullRequest', pullRequestSchema);

module.exports = {
    PullRequest: PullRequest
};
