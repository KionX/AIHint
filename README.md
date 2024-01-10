# AIHint GitHub Action
Designed to automate interactions with issues and commits in your repository using an AI language model.

## Features
- Analyzes issue or PR.
- Searches and fetch extra info.
- Generates AI-based content related to the fetched data.
- Posts or edits comment for issue.
- Customizable through environment variables and rules txt file.

## Config
- Required:
  - GITHUB_TOKEN
  - ISSUE_NUMBER
  - AI_TOKEN(ai.google.dev)
- Optiontal:
  - AI_MODEL(default: models/gemini-pro)
  - RULES_PATH(default: local Rules.txt)
  - SEARCH_REPO(default: caller)
  - BOT_NAME(default: AI Hint)

## Usage
```YML
name: AI Issue Response
on:
  issues:
    types: [opened, edited]

jobs:
  respond:
    runs-on: ubuntu-latest
    steps:
      - uses: KionX/AIHint@v1
        env:
          GITHUB_TOKEN: ${{secrets.GITHUB_TOKEN}}
          ISSUE_NUMBER: ${{github.event.issue.number}}
          AI_TOKEN: ${{secrets.AI_TOKEN}}
          RULES_PATH: .github/workflows/Rules.txt
          SEARCH_REPO: FAForever/fa
          BOT_NAME: AI Hint
```

# License
- When modifying, specify the origin/source author/repository.
- Author of original have the right to use all found by him modifications at him discretion.