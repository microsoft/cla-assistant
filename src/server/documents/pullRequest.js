var mongoose = require('mongoose');
mongoose.Promise = require('q').Promise;

var pullRequestSchema = mongoose.Schema({
    ownerId: String,
    owner: String,
    repoId: String,
    repo: String,
    number: String,
    userId: String,
    user: String,
    created_at: String
});

pullRequestSchema.index({
    userId: 1,
    repoId: 1,
    number: 1
}, {
    unique: true
});

pullRequestSchema.index({
    userId: 1,
    ownerId: 1
});

var PullRequest = mongoose.model('PullRequest', pullRequestSchema);

module.exports = {
    PullRequest: PullRequest
};
