import Phaser from 'phaser';

/** Authored scenery for Brookford. All railway, cargo and project state stays in the session. */
export function drawRiversideVillage(scene: Phaser.Scene): void {
  const ground=scene.add.graphics().setDepth(-25);
  const buildings=scene.add.graphics().setDepth(5);
  const path=(points:number[][],width:number,colour:number,alpha=1)=>{
    ground.lineStyle(width,colour,alpha);ground.beginPath();points.forEach(([x,y],i)=>i?ground.lineTo(x,y):ground.moveTo(x,y));ground.strokePath();
  };
  const road=(points:number[][])=>{path(points,56,0x727c66,.5);path(points,43,0xd5cbb5);path(points,29,0x8e9690);path(points,2,0xd6d2b8,.65);};
  // Long, irregular paddocks with headlands, fine crop rows and clipped hedges.
  const fields=[{x:1550,y:850,w:640,h:490,c:0xb4ad78},{x:2330,y:930,w:810,h:430,c:0xc5bb7e},
    {x:3180,y:820,w:610,h:560,c:0x97a778},{x:1380,y:3100,w:640,h:550,c:0xb9b483},
    {x:4300,y:3190,w:750,h:470,c:0xa4ad79},{x:5050,y:3130,w:760,h:580,c:0xc9bd85}];
  fields.forEach((f,index)=>{
    ground.fillStyle(0x667856,.5);ground.fillRoundedRect(f.x-13,f.y-13,f.w+26,f.h+26,25);
    ground.fillStyle(f.c);ground.fillRoundedRect(f.x,f.y,f.w,f.h,15);
    ground.lineStyle(2,index%2?0x7f8c60:0xe0cb96,.32);
    for(let y=f.y+20;y<f.y+f.h-15;y+=13)ground.lineBetween(f.x+15,y,f.x+f.w-15,y);
    ground.lineStyle(7,0x667e52,.7);ground.strokeRoundedRect(f.x-5,f.y-5,f.w+10,f.h+10,20);
    for(let x=f.x;x<f.x+f.w;x+=48){ground.fillStyle(0x718552,.8);ground.fillCircle(x,f.y-9,9);}
  });
  road([[100,1400],[1100,1390],[1600,1470],[3500,1470],[4020,1390],[5700,1390],[6400,1460]]);
  road([[4180,400],[4180,1390]]);road([[4890,450],[4890,1390],[5070,1610]]);
  road([[5550,700],[5550,1390]]);road([[4030,810],[5600,810]]);road([[4030,1110],[5550,1110]]);
  path([[1050,1390],[1050,1870],[910,1990]],34,0xc8bca0);
  path([[5400,1390],[6000,1770],[6000,2270],[5340,2270]],28,0xc8bca0);
  path([[4700,1570],[4780,1690]],34,0xc8bca0);
  // Small back gardens give each roof a readable parcel and avoid a carpet of unrelated houses.
  const roof=(x:number,y:number,w:number,h:number,colour:number,index:number)=>{
    ground.fillStyle(index%2?0x91a677:0xa3b285);ground.fillRect(x-12,y-25,w+24,h+66);
    ground.lineStyle(3,0x677c58,.75);ground.strokeRect(x-12,y-25,w+24,h+66);
    ground.fillStyle(0xd6cbb3);ground.fillRect(x+w*.45,y+h,w*.14,36);
    buildings.fillStyle(0x243c34,.19);buildings.fillRoundedRect(x+10,y+13,w+4,h+7,4);
    buildings.fillStyle(0xc5b799);buildings.fillRect(x-3,y+4,w+6,h+5);
    buildings.fillStyle(colour);buildings.fillRect(x,y,w,h);
    buildings.fillStyle(0xffffff,.1);buildings.fillRect(x,y,w,h*.47);
    buildings.fillStyle(0x253530,.15);buildings.fillRect(x,y+h*.53,w,h*.47);
    buildings.lineStyle(2,0xead8b7,.2);for(let row=9;row<h;row+=8)buildings.lineBetween(x+2,y+row,x+w-2,y+row);
    buildings.lineStyle(4,0xd4c4a5,.7);buildings.lineBetween(x-2,y+h/2,x+w+2,y+h/2);
    buildings.fillStyle(0x263b37,.28);buildings.fillRect(x+w*.65+5,y+h*.3+5,12,15);
    buildings.fillStyle(0xbcae95);buildings.fillRect(x+w*.65,y+h*.3,12,15);
    buildings.fillStyle(0x324542);buildings.fillRect(x+w*.65+3,y+h*.3+3,6,8);
    if(index%3===0){buildings.fillStyle(0x95b2af);buildings.fillRect(x+17,y+9,17,11);buildings.lineStyle(2,0xcbd2c0);buildings.strokeRect(x+17,y+9,17,11);}
  };
  let i=0;const colours=[0x8d6552,0x677e7b,0xa2765e,0x7e8276,0x94775d];
  for(const [y,start,end] of [[590,4290,5450],[900,4270,5440],[1190,4270,5440]]){
    for(let x=start;x<end;x+=167){if(Math.abs(x-4890)<100)continue;roof(x,y,94+i%3*9,69+i%2*10,colours[i%colours.length],i++);}
  }
  // Village green, church and shops anchor the settlement instead of anonymous facility circles.
  ground.fillStyle(0x8ca677);ground.fillRoundedRect(4960,390,360,135,28);
  path([[4980,451],[5300,451]],14,0xd5c8a8);
  roof(4480,375,190,85,0x637574,i++);roof(4540,324,70,190,0x637574,i++);
  buildings.fillStyle(0xcec2a8);buildings.fillRect(4480,382,55,70);buildings.fillStyle(0x576d69);buildings.fillTriangle(4480,382,4507,347,4535,382);
  for(let j=0;j<4;j++){roof(4290+j*124,1445,102,75,colours[j],i++);buildings.fillStyle(j%2?0xe0d1a4:0x396e63);buildings.fillRect(4290+j*124,1515,102,18);}
  // Road furniture, allotments, a farmstead and a modest yard make ordinary ground rewarding to inspect.
  roof(1770,565,175,90,0x9b7961,i++);roof(1980,620,100,70,0x6b817d,i++);
  for(let j=0;j<10;j++){ground.fillStyle(j%2?0x667e50:0x8b8960);ground.fillRect(5650+(j%5)*55,900+Math.floor(j/5)*150,40,120);}
  for(let j=0;j<7;j++){buildings.fillStyle(j%3===0?0xb9886a:0x657e7f);buildings.fillRoundedRect(4960+j*44,1574,22,43,4);buildings.fillStyle(0xc5d0bb);buildings.fillRect(4963+j*44,1582,16,11);}
  const label=(x:number,y:number,text:string,size:number)=>scene.add.text(x,y,text,{fontFamily:'Georgia,serif',fontSize:size,color:'#2f5148',stroke:'#e0dabe',strokeThickness:1}).setOrigin(.5).setDepth(8).setAlpha(.85);
  label(4820,270,'B R O O K F O R D',51);label(2580,3040,'R i v e r   A l d e r',36);
}
