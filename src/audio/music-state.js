/* Shared Music State Bus. This source is embedded into standalone 61.html at release time. */
function createMusicStateBus(getManualBPM) {
  const musicState = {
    bass:0, mid:0, high:0,
    bassEnvelope:0, midEnvelope:0, highEnvelope:0,
    energy:0, energyEnvelope:0,
    beat:0, onset:false, bpm:120, bpmSource:'fallback',
    beatPhase:0, barPhase:0, phrasePhase:0, dropProbability:0,
    now:0, deltaMs:16.7, frame:0
  };
  let beats=0, previousNow=null, previousBeat=0;

  function resetMusicState(){
    musicState.bass=musicState.mid=musicState.high=0;
    musicState.bassEnvelope=musicState.midEnvelope=musicState.highEnvelope=0;
    musicState.energy=musicState.energyEnvelope=musicState.beat=musicState.dropProbability=0;
    musicState.onset=false; musicState.beatPhase=musicState.barPhase=musicState.phrasePhase=0;
    beats=0; previousNow=null; previousBeat=0;
  }

  function updateMusicState(now, bass, mid, high, beatValue, hasAudio){
    const t=Number.isFinite(now)?now:performance.now();
    const deltaMs=previousNow==null ? 16.7 : Math.min(100,Math.max(0,t-previousNow));
    previousNow=t;
    const b=hasAudio?Math.max(0,Math.min(1,bass||0)):0;
    const m=hasAudio?Math.max(0,Math.min(1,mid||0)):0;
    const h=hasAudio?Math.max(0,Math.min(1,high||0)):0;
    const manualBPM=getManualBPM();
    const bpm=(typeof manualBPM==='number' && manualBPM>0)?manualBPM:120;
    const onset=hasAudio && beatValue>=0.999 && previousBeat<0.999;
    previousBeat=hasAudio?beatValue:0;
    beats += deltaMs*bpm/60000;
    if(onset) beats=Math.round(beats);
    const follow=(current,target,ms)=>current+(target-current)*(1-Math.exp(-deltaMs/ms));
    musicState.bass=b; musicState.mid=m; musicState.high=h;
    musicState.bassEnvelope=follow(musicState.bassEnvelope,b,90);
    musicState.midEnvelope=follow(musicState.midEnvelope,m,135);
    musicState.highEnvelope=follow(musicState.highEnvelope,h,65);
    musicState.energy=b*0.45+m*0.35+h*0.20;
    const previousEnergyEnvelope=musicState.energyEnvelope;
    musicState.energyEnvelope=follow(previousEnergyEnvelope,musicState.energy,180);
    musicState.beat=hasAudio?Math.max(0,Math.min(1,beatValue||0)):0;
    musicState.onset=onset; musicState.bpm=bpm; musicState.bpmSource=manualBPM?'manual':'fallback';
    musicState.beatPhase=((beats%1)+1)%1;
    musicState.barPhase=((beats%4)+4)%4/4;
    musicState.phrasePhase=((beats%16)+16)%16/16;
    const rise=Math.max(0,musicState.energy-previousEnergyEnvelope);
    musicState.dropProbability=Math.min(1,rise*2.4+(onset?0.35:0)+musicState.bassEnvelope*0.2);
    musicState.now=t; musicState.deltaMs=deltaMs; musicState.frame++;
    return musicState;
  }

  return { musicState, resetMusicState, updateMusicState };
}

const { musicState, resetMusicState, updateMusicState } = createMusicStateBus(() => manualBPM);
