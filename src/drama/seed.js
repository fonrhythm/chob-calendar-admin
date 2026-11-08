export const initialData = {
 dramas:[{id:'demo-drama',titleEn:'Where Our Days Begin',titleZh:'我们的晴天',titleTh:'',types:['Boys Love'],production:'已杀青',poster:'',synopsis:'示例剧集，用于测试排播与变动公告。',cast:[{artistId:'artist-a',name:'Artist A',role:'Sun',lead:true},{artistId:'artist-b',name:'Artist B',role:'Rain',lead:true}],rules:[{id:'youtube',platformId:'youtube',premiere:'2026-11-06',totalEpisodes:12,intervalDays:7,episodesPerRelease:1,time:'21:30',timezone:'Asia/Bangkok'}]}, {id:'demo-ensemble',titleZh:'下一个故事',types:['Bromance','群像'],production:'已开机',poster:'',synopsis:'尚未定档的示例，只在剧集库展示。',cast:[],rules:[]}],
 platforms:[{id:'youtube',name:'YouTube',logo:''},{id:'iqiyi',name:'爱奇艺',logo:''}],
 artists:[{id:'artist-a',name:'Artist A'},{id:'artist-b',name:'Artist B'}],
 events:[{id:'event-1',dramaId:'demo-drama',name:'我们的晴天 · Press Tour',type:'Press Tour',date:'2026-11-05',time:'14:00',location:'Bangkok',artistIds:['artist-a','artist-b']}],changes:[]
};
