# How to run in local

Install Node.js at first, then install dependencies of this project by run:
* `npm install`

Then install nodemon by command:
* `npm install -g nodemon`

Copy `.env.template` file and rename to `.env`, then fill slack bot and app token in it.

Install mongodb in local and use `slack-bot` database. Or connect to remote mongodb by modify `.env` file
* https://docs.mongodb.com/manual/tutorial/install-mongodb-on-os-x/#install-mongodb-community-edition

start dev server:
* `npm run start`

# About Slack Bolt
### Tutorial
https://slack.dev/bolt-js/tutorial/getting-started

### API Doc
https://api.slack.com/block-kit

### Online block builder
https://app.slack.com/block-kit-builder/

# About Moongoose
### Schema：
https://mongoosejs.com/docs/guide.html#definition

### Models
https://mongoosejs.com/docs/models.html

### Queries：
https://mongoosejs.com/docs/queries.html

### Validation
https://mongoosejs.com/docs/validation.html


### About node.schedule
https://github.com/node-schedule/node-schedule


### About web api
https://www.npmjs.com/package/@slack/web-api