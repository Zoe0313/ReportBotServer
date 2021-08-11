import { loadBlocks } from '../utils.js'

export function commonService(app) {

   // Reply in channel
   app.event('app_mention', async ({ event, say }) => {
      await say(`Hi, <@${event['user']}>. I'm a little shy in public, but I'll follow up you by direct message.`)
   })
   // Home page
   app.event('app_home_opened', async ({ client, event, logger }) => {
      try {
         await client.views.publish({
            user_id: event['user'],
            view: {
               'type': 'home',
               'private_metadata': event['channel'],
               'callback_id': 'home_view',
               'blocks': loadBlocks('welcome'),
            }
         })
      } catch (e) {
         logger.error(`Error publishing home tab: ${e}`)
      }
   })

   // Hi page
   app.message(/^(hi|hello|hey)/i, async ({ event, say }) => {
      await say({
         blocks: loadBlocks('welcome'),
         text: 'Select an action'
      })
   })

}