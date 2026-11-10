export const dramaCategoryColors={
 'Boys Love':{background:'#6F9DD4',text:'#FFFFFF',badge:'#557FB4',outline:'#6F9DD4'},
 'Girls Love':{background:'#D3D0DF',text:'#696575',badge:'#EFEDF5',outline:'#9089A7'},
 'BG':{background:'#F9F5ED',text:'#2A2A2A',badge:'#EEEBE5',outline:'#8C939C'},
 'Bromance':{background:'#C3CCD5',text:'#293744',badge:'#E9EEF2',outline:'#65798C'},
 '群像':{background:'#2A2A2A',text:'#FFFFFF',badge:'#454545',outline:'#2A2A2A'},
 '其他':{background:'#C3CCD5',text:'#293744',badge:'#E9EEF2',outline:'#65798C'},
};
export function dramaCategoryStyle(types=[]){const color=types.map(t=>dramaCategoryColors[t]).find(Boolean)||dramaCategoryColors['其他'];return {'--drama-chip-bg':color.background,'--drama-chip-text':color.text,'--drama-chip-badge':color.badge,'--drama-chip-outline':color.outline};}
