import { loadBlocks, updateUserTzCache } from '../../common/slack-helper.js'

export function registerCommonServiceHandler(app) {
   // Reply in channel
   app.event('app_mention', async ({ event, say }) => {
      await say(`Hi, <@${event.user}>. ` +
         `I'm a little shy in public, but I'll follow up you by direct message.`)
   })

   // Home page
   app.event('app_home_opened', async ({ client, event, logger }) => {
      try {
         await client.views.publish({
            user_id: event.user,
            view: {
               type: 'home',
               private_metadata: event.channel,
               callback_id: 'home_view',
               blocks: loadBlocks('welcome')
            }
         })
      } catch (e) {
         logger.error(`Error publishing home tab: ${e}`)
      }
   })

   // Hi page
   app.message(/^(hi|hello|hey|help)/i, async ({ say }) => {
      await say({
         blocks: loadBlocks('welcome'),
         text: 'Select an action'
      })
   })

   // user profile change
   // app.event('user_change', async ({ payload }) => {
   //    const userId = payload?.user?.id
   //    const tz = payload?.user?.tz
   //    console.log(`user change event happened for user ${userId}, tz ${tz}`)
   //    updateUserTzCache(userId, tz)
   // })
}
