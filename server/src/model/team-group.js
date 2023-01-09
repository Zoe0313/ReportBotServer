import mongoose from 'mongoose'
import logger from '../../common/logger.js'
import {
   PerforceCheckInMembersFilterSchema, FlattenMembers
} from './report-configuration.js'

const TeamGroupSchema = new mongoose.Schema({
   code: {
      type: String,
      required: true
   },
   name: {
      type: String,
      required: true
   },
   membersFilters: {
      type: [PerforceCheckInMembersFilterSchema]
   },
   members: {
      type: [String],
      require: true
   }

}, { timestamps: true })

const TeamGroup = mongoose.model('TeamGroup', TeamGroupSchema)

const UpdateTeamGroup = async () => {
   const initTeams = [{
      code: 'vsan',
      name: 'vsan engineers',
      membersFilters: [{
         condition: 'include',
         type: 'all_reporters',
         // include vsubhashini(WPVQ9M7QT), bstoicov(WAAGN7CBE), Venkata(WABQUSMQX),
         // Ninad(WABQS3KK9), ffeng(WAATHDZK7), pudis(WABQY8DF1), Abhijit(WAAGJJCMA),
         // jakeli(WAAPBH3FC), achakravarti(WABLCQTFG) all
         members: ['WPVQ9M7QT', 'WAAGN7CBE', 'WABQUSMQX', 'WABQS3KK9', 'WAATHDZK7',
            'WABQY8DF1', 'WAAGJJCMA', 'WAAPBH3FC', 'WABLCQTFG']
      },
      {
         condition: 'include',
         type: 'selected',
         // include amdurm(WAA2WLE72), daip(WABL9CTK8), randhirs(WAAGK72PN), adesai(WABLDKJPQ),
         // eknauft(WAAPCHAHY), prenauld(WAA319ZK2), wenguangw(WAAGMNVHS), ochen(WCJQY2KSM) all
         members: ['WAA2WLE72', 'WABL9CTK8', 'WAAGK72PN', 'WABLDKJPQ', 'WAAPCHAHY',
            'WAA319ZK2', 'WAAGMNVHS', 'WCJQY2KSM']
      }
      ]
   }]

   // init teams empty data in db
   await Promise.all(initTeams.map(team => {
      return TeamGroup.findOne({ code: team.code }).then(res => {
         if (res == null) {
            const newTeam = new TeamGroup(team)
            return newTeam.save().then(res => {
               logger.info(`save init team ${res} in db`)
            })
         }
      })
   }))

   const teams = await TeamGroup.find()
   await Promise.all(teams.map(async team => {
      const members = await FlattenMembers(team.membersFilters)
      team.members = members
      await team.save()
      logger.info(`saved team ${team.name} members ${JSON.stringify(team.members)}`)
   }))
}

export { TeamGroup, UpdateTeamGroup }
