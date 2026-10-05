import type Phaser from 'phaser';
import type { RegionalFootprint } from '../region/RegionalProjects';

export function drawNeighbourhood(g:Phaser.GameObjects.Graphics,f:RegionalFootprint):void{
  g.fillStyle(0xa5b88b);g.fillRoundedRect(f.x-f.radius,f.y-f.radius,f.radius*2,f.radius*2,25);
  g.lineStyle(24,0xd8cdb3);g.lineBetween(f.x-f.radius,f.y,f.x+f.radius,f.y);
  for(let i=0;i<f.buildingCount;i++){
    const x=f.x-f.radius*.67+(i%3)*f.radius*.63,y=f.y-f.radius*.62+Math.floor(i/3)*f.radius*.65;
    g.fillStyle(0x243e32,.17);g.fillRect(x-22+8,y-21+10,52,39);
    g.fillStyle(0xdad0b5);g.fillRect(x-26,y-21,54,39);
    g.fillStyle(i%3===0?0xa67e62:0x647f77);g.fillRect(x-25,y-24,52,34);
    g.fillStyle(0xf3e1b8,.16);g.fillRect(x-25,y-24,52,16);
    g.lineStyle(2,0xd7c5a6);g.lineBetween(x-27,y-7,x+29,y-7);
    g.fillStyle(0x43564e);g.fillRect(x+12,y-18,6,8);
    g.fillStyle(0x7c965d);g.fillCircle(x-33,y+24,10);
  }
}
