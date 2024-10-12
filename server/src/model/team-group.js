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
   const initTeams = [
      {
         code: 'vsan-all',
         name: 'vsan members',
         membersFilters: [{
            condition: 'include',
            type: 'all_reporters',
            // include Ninad Kulkarni(nk017170), Satish Pudi(sp026337), Fanny Wong(fw036298) all
            members: ['nk017170', 'sp026337', 'fw036298']
         },
         {
            condition: 'exclude',
            type: 'selected',
            // exclude service account
            members: ['vsan-lsom-svc', 'vsan-st', 'svc-vsan-er',
               'svc-vsanci', 'svc-vsanfvt1', 'svc-portal-vsanst',
               'svc.vsan-st', 'svc.readylabs-st', 'vsancert.program',
               'vsanperf', 'humbug-deployer', 'svc-vmpool',
               'svc-vmpool-stg', 'vsanperfsvc', 'mgmtsherpa',
               'galileosvc', 'svc-vcfsherpa-auto1', 'svc-blrsrmvrst',
               'svc.srmvrtestuser1', 'vsan-cert-suite', 'vsancert',
               'svc-vcffvt-zilly-1', 'svc-at-vsanst', 'svc-vsan-cov',
               'svc-vsan-bugs']
         },
         {
            condition: 'include',
            type: 'selected',
            // include developers Matt Amdur(ma001135), Peng Dai(pd006857), Asit Desai(ad007523),
            // Wenguang Wang(ww035649), Oswald Chen(oc005573) all
            members: ['ma001135', 'pd006857', 'ad007523', 'ww035649',
               'oc005573', 'sy036818', 'az037818', 'jf009278', 'gx036572']
         }]
      },
      {
         code: 'vsan-dev',
         name: 'vsan developers',
         membersFilters: [{
            condition: 'include',
            type: 'all_reporters',
            // include Ninad Kulkarni(nk017170), Satish Pudi(sp026337), Fanny Wong(fw036298) all
            members: ['nk017170', 'sp026337', 'fw036298']
         },
         {
            condition: 'exclude',
            type: 'selected',
            // exclude service account
            members: ['vsan-lsom-svc', 'vsan-st', 'svc-vsan-er',
               'svc-vsanci', 'svc-vsanfvt1', 'svc-portal-vsanst',
               'svc.vsan-st', 'svc.readylabs-st', 'vsancert.program',
               'vsanperf', 'humbug-deployer', 'svc-vmpool',
               'svc-vmpool-stg', 'vsanperfsvc', 'mgmtsherpa',
               'galileosvc', 'svc-vcfsherpa-auto1', 'svc-blrsrmvrst',
               'svc.srmvrtestuser1', 'vsan-cert-suite', 'vsancert',
               'svc-vcffvt-zilly-1', 'svc-at-vsanst', 'svc-vsan-cov',
               'svc-vsan-bugs']
         },
         {
            condition: 'exclude',
            type: 'all_reporters',
            // exclude tester from Huang Zhou(zh013529), Venkata Pendiyala(vp025371), Rounak Pramanik(rp026182) all reporters
            members: ['zh013529', 'vp025371', 'rp026182']
         },
         {
            condition: 'include',
            type: 'selected',
            // include developers Matt Amdur(ma001135), Peng Dai(pd006857), Asit Desai(ad007523),
            // Wenguang Wang(ww035649), Oswald Chen(oc005573), Sixuan Yang(sy036818),
            // Alvin Zhang(az037818), Jianan Feng(jf009278), Grace Xu(gx036572) all
            members: ['ma001135', 'pd006857', 'ad007523', 'ww035649',
               'oc005573', 'sy036818', 'az037818', 'jf009278', 'gx036572']
         }]
      },
      {
         code: 'figo-all',
         name: 'Figo team members',
         membersFilters: [{
            condition: 'include',
            type: 'all_reporters',
            // Figo Feng(ff009279)
            members: ['ff009279']
         },
         {
            condition: 'exclude',
            type: 'selected',
            // exclude service account
            members: ['vsanperf', 'humbug-deployer', 'svc-vmpool',
               'svc-vmpool-stg', 'vsanperfsvc']
         }]
      },
      {
         code: 'figo-dev',
         name: 'Figo team developers',
         membersFilters: [{
            condition: 'include',
            type: 'all_reporters',
            // Figo Feng(ff009279)
            members: ['ff009279']
         },
         {
            condition: 'exclude',
            type: 'selected',
            // exclude service account
            members: ['vsanperf', 'humbug-deployer', 'svc-vmpool',
               'svc-vmpool-stg', 'vsanperfsvc']
         },
         {
            condition: 'exclude',
            type: 'all_reporters',
            // exclude tester from Huang Zhou(zh013529)
            members: ['zh013529']
         },
         {
            condition: 'include',
            type: 'selected',
            // include developers: Sixuan Yang(sy036818), Alvin Zhang(az037818), Jianan Feng(jf009278),
            // Grace Xu(gx036572) all
            members: ['sy036818', 'az037818', 'jf009278', 'gx036572']
         }]
      },
      {
         code: 'vdfs',
         name: 'vsan vdfs team',
         membersFilters: [{
            condition: 'include',
            type: 'selected',
            // include Liuhua Chen, Isabell Huang, Charlene Tu, Joseph Huang,
            // Xinyan Wu, Leo Fan, Sunil Bhargo, Essen Yu,
            // Shiju Rajan, Albert Guo, Jagnya Datta Tripathy, Grace Xu,
            // Maneesh Kumar Gunda, Shreesha Rao, Xin Huang all
            members: ['lc005566', 'ih013474', 'ct034015', 'jh013465',
               'xw036471', 'lf009146', 'sb003280', 'ey037167',
               'sr026871', 'ag011741', 'jt033903', 'gx036572',
               'mg011689', 'sr027275', 'xh013519']
         }]
      },
      {
         code: 'zdom',
         name: 'vsan zdom team',
         membersFilters: [{
            condition: 'include',
            type: 'selected',
            // include Qinkai Fan, Yun Hong, Quanxing Liu, Enning Xiang,
            // Chandrakanth Gadhiraju, Alvin Zuo, Pascal Renauld, Yifan Wang,
            // Xin Li, Salit Gazit, Ishvar Garewal, Maxime Austruy,
            // Long Yang all
            members: ['qf009140', 'yh013235', 'ql018865', 'ex036513',
               'cg009972', 'az038102', 'pr027640', 'yw035675',
               'xl018554', 'sg010452', 'ig010290', 'ma001888',
               'ly036806']
         }]
      }
   ]

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
      logger.info(`saved team ${team.name} members, size: ${team.members.length}`)
   }))
}

export { TeamGroup, UpdateTeamGroup }
