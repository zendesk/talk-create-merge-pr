const core = require('@actions/core')
const github = require('@actions/github')

const DEFAULT_ALLOWED_SOURCE_BRANCH_LIST = ['master']
const GITHUB_OWNER = core.getInput('github-owner')
const GITHUB_REPO = core.getInput('github-repo')
const BRANCH_REF = core.getInput('branch-ref')
const BOT_USER_NAME = core.getInput('bot-user-name')

const githubToken_action = core.getInput('github-token')
const githubToken_artifact = core.getInput('artifact-github-token')
const octokit_action = new github.GitHub(githubToken_action)
const octokit_artifact = new github.GitHub(githubToken_artifact)


function writeError(msg) {
  console.log(`Error: ${msg}`)
}

async function createPullRequest (head, base, title, body) {
  try {
    const { data: pullRequest } = await octokit_artifact.pulls.create({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,

      head: head,
      base: base,
      title: title,
      body: body,

      maintainer_can_modify: true
    })

    return pullRequest
  } catch (error) {
    writeError(`failed to create pull request: ${error}`)
  }
}

async function createLabel (pullRequestNum) {
  try {
    const { data: label } = await octokit_artifact.issues.addLabels({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      issue_number: pullRequestNum,
      labels: ['manifest_generation', 'skip_tests']
    })

    return label
  } catch (error) {
    writeError(`failed to create label for pull request: ${error}`)
  }
}

// If PR is in an clean, dirty or unstable state, it will be resolved and marked as mergable
// Clean means PR has no issues
// Dirty means pr has minor issues
// Unstable means checks are still running
// If the PR is in a blocked state, a required check, it will retry until it isn't blocked anymore or it's hit the limit of 7
async function getPrMergeableState (pullRequestNum) {
  return new Promise((resolve, reject) => {
    let tries = 0
    const retryUntilStateKnown = async () => {
      try {
        console.log(`Attempting to get pull request state`)
        tries++
        const pullRequest = await getPullRequest(pullRequestNum)
        const prMergeState = pullRequest.mergeable_state
        console.log(prMergeState)
        if (prMergeState === 'clean' || prMergeState === 'dirty') {
          resolve(prMergeState)
          return
        } else if (tries > 25) {
          console.log('Pull request mergeable state is unknown')
          reject(new Error('Pull request mergeable state is unknown'))
          return
        } else {
          if (prMergeState === 'unstable') {
            console.log('Pull Request has checks still running, waiting for checks to finish')
          }
          console.log('Pull request not ready, waiting 60 seconds and then trying again')
          setTimeout(retryUntilStateKnown, 60000)
        }
      } catch (error) {
        console.log(`Failed getting merge state of pull request: ${error}`)
        reject(error)
      }
    }
    retryUntilStateKnown
  })
}

async function approvePullRequest (pullRequestNum) {	
  try {	
    console.log('Approving pull request')	
    await octokit_action.pulls.createReview({	
      owner: GITHUB_OWNER,	
      repo: GITHUB_REPO,	
      pull_number: pullRequestNum,	
      event: 'APPROVE'	
    })	
  } catch (error) {	
    core.setFailed(`Failed to approve pull request: ${error}`)	
  }	
}

async function mergePullRequest (pullRequestNum) {
  try {
    console.log('Merging pull request')
    await octokit_action.pulls.merge({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      pull_number: pullRequestNum
    })
  } catch (error) {
    core.setFailed(`Failed to merge pull request: ${error}`)
  }
}

async function getPullRequest (pullRequestNum) {
  try {
    const { data: pullRequest } = await octokit_action.pulls.get({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      pull_number: pullRequestNum
    })

    return pullRequest
  } catch (error) {
    console.log(`Failed to get pull request data: ${error}`)
  }
}

try {
  const run = async () => {
    // fetch action inputs
    const title = core.getInput('title') 
    const body = core.getInput('body')
    let base = core.getInput('base')

    if (base === '') {
      // if not given, default target branch for the created PR is 'master'
      base = 'master'
    }

    console.log(`GitHub owner: ${GITHUB_OWNER} GitHub repo: ${GITHUB_REPO}`) 

    function defaultMsg(str, markdown) {
      if (str === '') {
        let quoteIt = ''
        if (markdown) {
          quoteIt = '`'
        }
      }

      return str
    }

    console.log(`BRANCH REF: ${BRANCH_REF}`) 
    const pullRequest = await createPullRequest(BRANCH_REF, base, defaultMsg(title), defaultMsg(body, true))
    if (pullRequest === undefined) {
      core.setFailed('unable to create pull request')
      return
    }
    const pullRequestNum = pullRequest.number

    console.log(`Pull request #${pullRequestNum} successfully created`)
    createLabel(pullRequest.number)

    // Start of PR Merge
    isApproved = await approvePullRequest(pullRequestNum)

    const prMergeState = await getPrMergeableState(pullRequestNum).then(state => state).catch()	

    if (!['clean'].includes(prMergeState)) {	
      const err = 'Can\'t merge pull request, merge state: ' + prMergeState	
      console.log(err)	
      throw err	
    }

    mergePullRequest(pullRequestNum)

  }

  run()
} catch (error) {
  core.setFailed(`Action failed: ${error}`)
}
