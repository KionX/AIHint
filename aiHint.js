'use strict';
const fs = require('fs');
const modelAI = 'models/gemini-pro';
const aiUrl = 'https://generativelanguage.googleapis.com/v1beta/';
const ghUrl = process.env.GITHUB_API_URL;
const aiApiKey = process.env.AI_TOKEN;
const ghApiKey = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const issue = process.env.ISSUE_NUMBER;
const rPath = process.env.RULES_PATH;
const sRepo = process.env.SEARCH_REPO || repo;
const botName = process.env.BOT_NAME || 'AI Hint';
let maxTokens, maxOutLen;

const setFailed = (msg) => {
  process.exitCode = 1;
  console.log(`::error::${msg}`);
}

const getURL = async (url, apiKey, noerr) => {
  let h = {};
  if (apiKey)
    h = {headers: {'Authorization': `Bearer ${apiKey}`}};
  const r = await fetch(url, h);
  const json = await r.json();
  if (r.ok) return json;
  if (noerr) return '';
  if (json.message)
    throw new Error(json.message); else
  if (json.error)
    throw new Error(json.error.message); else
    throw new Error(`Response status: ${r.status}`);
}

const GAIConfig = async () => {
  const r = await getURL(aiUrl + modelAI + '?key=' + aiApiKey);
  maxTokens = r.inputTokenLimit;
  maxOutLen = r.outputTokenLimit;
}

const tokensLen = async (str) => {
  const url = aiUrl + modelAI + ':countTokens?key=' + aiApiKey;
  const r = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [{parts:[{text:str}]}]
    })
  })
  if (!r.ok)
    throw new Error(`Response status: ${r.status}`);
  const json = await r.json();
  return json.totalTokens;
}

const strTokensTrim = async (str, limit) => {
  let toks = await tokensLen(str);
  while (toks > limit) {
    str = str.slice(0, Math.floor(str.length * limit / toks) - 1);
    toks = await tokensLen(str);
  }
  return str;
}

const sendGAIRequest = async (apiKey, model, prompt, max_tokens) => {
  const url = aiUrl + model + ':generateContent?key=' + apiKey;
  const r = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: model,
      contents: [{parts:[{text:prompt}]}],
      generationConfig: {
        temperature: 0, topK: 1, topP: 1,
        maxOutputTokens: max_tokens,
        stopSequences: []
      },
      safetySettings: [
        {category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
        {category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
        {category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE'},
        {category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE'}
      ]
    })
  });
  const json = await r.json();
  if (json.candidates)
    return json.candidates[0].content.parts[0].text;
  if (json.error)
    throw new Error(json.error.message); else
    throw new Error(`Response status: ${r.status}`);
}

const fetchCommit = async (i) => {
  let data = `{Commit: ${i.commit.author.name}\nSha: ${i.sha}\n${i.commit.message}\n\n`;
  if (i.commit.comment_count > 0) {
    const c = await getURL(i.comments_url, ghApiKey);
    if (c.forEach)
      c.forEach(i => data += `${i.user.login}:\n${i.body}\n\n`);
  }
  return data + '}';
}

const fetchIssue = async (i) => {
  let data = '{';
  let state = '';
  if (i.closed_at) state = 'Closed ';
  if (i.pull_request) {
    if (i.pull_request.merged_at) state = 'Merged ';
    data += state + 'Pull Request: ';
  } else
    data += state + 'Issue: ';
  data += `${i.title}\nNumber: ${i.number}\n${i.user.login}:\n${i.body}\n\n`;
  if (i.comments > 0) {
    const c = await getURL(i.comments_url, ghApiKey);
    if (c.forEach)
      c.forEach(i => data += `${i.user.login}:\n${i.body}\n\n`);
  }
  return data + '}';
}

const getLabels = async (repo) => {
  let labels = 'Labels: {\n';
  const r = await getURL(`${ghUrl}/repos/${repo}/labels`, ghApiKey);
  for (const i of r)
    labels += `"${i.name}" ${i.description}\n\n`;
  return labels + '}';
}

const extractLinks = (str, repo) => {
  const getIssue = async (i) => {
    const url = `${ghUrl}/repos/${(i[1] || repo)}/`;
    const r = await getURL(url + `issues/${i[2]}`, ghApiKey, true);
    if (r.id)
      return await fetchIssue(r);
    return '';
  }
  const getCommit = async (c) => {
    const url = `${ghUrl}/repos/${repo}/commits/${c[0]}`;
    const r = await getURL(url, ghApiKey, true);
    if (r.sha)
      return await fetchCommit(r);
    return '';
  }

  const promises = {};
  let regex = /([\w-]+\/[\w-]+)*#(\d+)/gs;
  for (const issue of str.matchAll(regex))
    promises[issue[2]] = getIssue(issue);

  regex = /[A-Fa-f0-9]{6,}/gs;
  for (const commit of str.matchAll(regex))
    promises[commit[0]] = getCommit(commit);

  return promises;
}

const getIssue = async (apiKey, repo, issue) => {
  console.log(`${repo}#${issue}`);
  const url = `${ghUrl}/repos/${repo}/issues/${issue}`;
  const r = await getURL(url, apiKey);
  return `${r.title}\n${r.body}`;
}

const newIssueComment = async (apiKey, repo, issue, text) => {
  const url = `${ghUrl}/repos/${repo}/issues/${issue}/comments`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {'Authorization': `Bearer ${apiKey}`},
    body: JSON.stringify({body: text})
  });
  if (!r.ok)
    throw new Error(`Response status: ${r.status}`);
  return await r.json();
}

const editIssueComment = async (apiKey, repo, commentId, text) => {
  const url = `${ghUrl}/repos/${repo}/issues/comments/${commentId}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {'Authorization': `Bearer ${apiKey}`},
    body: JSON.stringify({body: text})
  });
  if (!r.ok)
    throw new Error(`Response status: ${r.status}`);
  return await r.json();
}

const getRules = async (apiKey, rPath) => {
  let url = 'https://raw.githubusercontent.com/';
  if (rPath)
    url += `${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_REF_NAME}/${rPath}`; else
    url += `${process.env.GITHUB_ACTION_REPOSITORY}/${process.env.GITHUB_ACTION_REF}/Rules.txt`;
  const r = await fetch(url, {headers: {'Authorization': `Bearer ${apiKey}`}});
  if (!r.ok)
    throw new Error(`Response status: ${r.status}`);
  return await r.text();
}

const makeHint = async () => {
  if (typeof aiApiKey !== 'string' || aiApiKey.trim().length !== 39)
    throw new Error('Invalid AI API key');

  const [labels, rDesc, q, rules] = await Promise.all([
    getLabels(sRepo), getURL(`${ghUrl}/repos/${sRepo}`, ghApiKey),
    getIssue(ghApiKey, repo, issue), getRules(ghApiKey, rPath), GAIConfig()
  ]);
  const [rSearch, rAnswer] = rules.split('---');

  const curDate = new Date().toISOString();
  let prompt = `${labels}\n\n${rSearch}\nDate: ${curDate}`
    + `\nRepo: {${rDesc.description}}\nQuestion: {${q}}\nGithub search:\n`;
  let r = await sendGAIRequest(aiApiKey, modelAI, prompt, 100);
  if (r.includes('#reject#')) return;
  let iPrompt = r.match(/Issues:(.+)/); iPrompt = iPrompt ? iPrompt[1] : '';
  let cPrompt = r.match(/Commits:(.+)/); cPrompt = cPrompt ? cPrompt[1] : '';
  console.log(`Commits:${cPrompt}\nIssues:${iPrompt}`);

  let data = '';
  let cr = {}; let ir = {};
  const promises = extractLinks(q, sRepo);
  if (cPrompt) {
    const per_page = Math.floor(maxTokens / 450);
    const url = `${ghUrl}/search/commits?per_page=${per_page}&q=repo:${sRepo}${cPrompt}`;
    cr = getURL(url, ghApiKey);
  }
  if (iPrompt) {
    const per_page = Math.floor(maxTokens / 900);
    const url = `${ghUrl}/search/issues?per_page=${per_page}&q=repo:${sRepo}${iPrompt}`;
    ir = getURL(url);
  }
  [cr, ir] = await Promise.all([cr, ir]);
  if (cr.items)
    for (const i of cr.items)
      if (!promises[i.sha])
        promises[i.sha] = fetchCommit(i);
  if (ir.items)
    for (const i of ir.items)
      if (!promises[i.id])
        promises[i.id] = fetchIssue(i);
  data += (await Promise.all(Object.values(promises))).join('');

  prompt = `\n{Prompt:\n${q}}\n\nDate: ${curDate}\n${rAnswer}\nAnswer:\n`;
  data = await strTokensTrim(data, maxTokens - (await tokensLen(prompt)));
  console.log(`Data: ${data.length} chars.`);
  prompt = data + prompt;
  prompt = await sendGAIRequest(aiApiKey, modelAI, prompt, maxOutLen);
  prompt = `${botName}:\n${prompt}`;

  r = (await getURL(`${ghUrl}/repos/${repo}/issues/${issue}/comments`, ghApiKey))[0];
  if (!r)
    return await newIssueComment(ghApiKey, repo, issue, prompt);
  if (r.user.type === 'Bot' && r.body.startsWith(botName))
    return await editIssueComment(ghApiKey, repo, r.id, prompt);
}

makeHint()
  .then(comment => console.log('Comment id:', comment ? comment.id : 'rejected'))
  .catch(error => setFailed(error.stack));