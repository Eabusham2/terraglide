// Writes speech.wav, the microphone input run.mjs feeds Chromium: the Oct 3 08:25 `node -e`, as logged.
// usage: node speech.cjs   (in the folder run.mjs runs from)
// A speech-like test signal: a voiced buzz (harmonics of a gliding pitch) in
// syllable-length bursts with gaps, 8 s, 48 kHz mono 16-bit, looped by Chrome.
const fs=require('fs');const rate=48000,secs=8,n=rate*secs;const d=Buffer.alloc(44+n*2);
d.write('RIFF',0);d.writeUInt32LE(36+n*2,4);d.write('WAVE',8);d.write('fmt ',12);d.writeUInt32LE(16,16);d.writeUInt16LE(1,20);d.writeUInt16LE(1,22);d.writeUInt32LE(rate,24);d.writeUInt32LE(rate*2,28);d.writeUInt16LE(2,32);d.writeUInt16LE(16,34);d.write('data',36);d.writeUInt32LE(n*2,40);
let ph=0;for(let i=0;i<n;i++){const t=i/rate;const f0=140+40*Math.sin(2*Math.PI*0.7*t);ph+=2*Math.PI*f0/rate;
let s=0;for(let h=1;h<=12;h++)s+=Math.sin(h*ph)/h*(h%3===0?1.4:1);
const syl=Math.max(0,Math.sin(2*Math.PI*3.5*t));const env=(t%2<1.6)?Math.pow(syl,0.6):0;
const v=Math.max(-1,Math.min(1,0.35*s*env));d.writeInt16LE(Math.round(v*32000),44+i*2);}
fs.writeFileSync('speech.wav',d);console.log('wrote',d.length);
