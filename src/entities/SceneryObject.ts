import Phaser from 'phaser';
import type { SceneryObjectDef, SceneryType } from '../config/WorldData';
import { OVERHEAD, artHash } from '../presentation/OverheadPalette';

/** Roof-first vegetation and geology. Persisted transforms affect shape, never the sun direction. */
export class SceneryObject extends Phaser.GameObjects.Container {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly shadowX: number;
  private readonly shadowY: number;

  constructor(scene: Phaser.Scene, def: SceneryObjectDef) {
    super(scene, def.x, def.y);
    scene.add.existing(this);
    this.gfx = scene.add.graphics();
    this.add(this.gfx);
    this.setRotation(def.rotation);
    this.setScale(def.scale);
    // Terrain and roofs retain an overhead layer order; a tree at large Y cannot hide a train.
    this.setDepth(20 + def.y * .0001);
    const c=Math.cos(def.rotation),s=Math.sin(def.rotation),scale=Math.max(.1,def.scale);
    this.shadowX=(8*c+10*s)/scale;
    this.shadowY=(-8*s+10*c)/scale;
    this.draw(def.type,Math.abs(Math.floor(def.variant))%4);
  }

  private draw(type: SceneryType, variant: number): void {
    switch(type){
      case 'tree_oak': this.drawCrown(50+variant*7,variant,false);break;
      case 'tree_birch': this.drawCrown(40+variant*5,variant,true);break;
      case 'tree_pine': this.drawPine(variant);break;
      case 'tree_dead': this.drawDeadTree(variant);break;
      case 'rock_boulder': this.drawBoulder(0,0,28+variant*7,variant);break;
      case 'rock_outcrop': for(let i=0;i<3+variant;i++)this.drawBoulder((i-1)*24,(i%2)*13,28+i*3,variant+i);break;
      case 'rock_cluster': for(let i=0;i<4+variant;i++){const a=i*2.3;this.drawBoulder(Math.cos(a)*i*13,Math.sin(a)*i*11,13+(i%3)*5,i);}break;
      case 'terrain_pond': this.drawPond(variant);break;
      case 'terrain_cliff': this.drawCliff(variant);break;
      case 'terrain_mound': this.drawMound(variant);break;
    }
  }

  private drawCrown(radius:number,variant:number,birch:boolean):void{
    const g=this.gfx;
    g.fillStyle(OVERHEAD.shadow,.08);g.fillEllipse(this.shadowX+3,this.shadowY+3,radius*2.18,radius*1.95);
    g.fillStyle(OVERHEAD.shadow,.16);g.fillEllipse(this.shadowX,this.shadowY,radius*2.02,radius*1.86);
    g.fillStyle(birch?0x5f7748:OVERHEAD.treeShade,1);g.fillEllipse(0,0,radius*1.92,radius*1.82);
    // Rounded lobes are a canopy seen from above, with no standing trunk or triangular tree.
    for(let i=0;i<11;i++){
      const angle=i*Math.PI*2/11+.27*variant;
      const distance=radius*(.48+artHash(i,variant,3)*.09),r=radius*(.38+artHash(i,variant,4)*.10);
      const x=Math.cos(angle)*distance,y=Math.sin(angle)*distance;
      g.fillStyle(birch?0x819559:OVERHEAD.tree,1);g.fillEllipse(x,y,r*2,r*1.85);
      g.fillStyle(birch?0xabb479:OVERHEAD.treeLight,.42);g.fillEllipse(x-5,y-7,r*1.26,r*1.09);
    }
    g.fillStyle(birch?0x91a566:0x6c8550,1);g.fillEllipse(-radius*.10,-radius*.12,radius*1.03,radius*.97);
    g.fillStyle(birch?0xb3bc82:0x91a86a,.28);g.fillEllipse(-radius*.21,-radius*.24,radius*.72,radius*.55);
    g.lineStyle(1.4,OVERHEAD.treeShade,.2);g.beginPath();g.moveTo(-radius*.25,radius*.08);g.lineTo(radius*.08,radius*.28);g.strokePath();
  }

  private drawPine(variant:number):void{
    const radius=40+variant*6,g=this.gfx;
    g.fillStyle(OVERHEAD.shadow,.18);g.fillEllipse(this.shadowX,this.shadowY,radius*2.05,radius*1.92);
    for(let tier=0;tier<3;tier++){
      const r=radius*(1-tier*.25),points:Phaser.Math.Vector2[]=[];
      for(let i=0;i<18;i++){const a=i*Math.PI*2/18+.2*variant,reach=r*(i%2===0?1:.57);points.push(new Phaser.Math.Vector2(Math.cos(a)*reach,Math.sin(a)*reach));}
      g.fillStyle([0x314b3b,0x49674b,0x6c855a][tier],1);g.fillPoints(points,true);
    }
    g.fillStyle(0x91a277,.5);g.fillEllipse(-7,-9,14,19);
  }

  private drawDeadTree(variant:number):void{
    const radius=37+variant*5,g=this.gfx;
    for(let i=0;i<7;i++){
      const angle=i*Math.PI*2/7+.3*variant,x=Math.cos(angle)*radius,y=Math.sin(angle)*radius;
      g.lineStyle(6,OVERHEAD.shadow,.14);g.beginPath();g.moveTo(this.shadowX,this.shadowY);g.lineTo(x+this.shadowX,y+this.shadowY);g.strokePath();
      g.lineStyle(4,0x766a50,1);g.beginPath();g.moveTo(0,0);g.lineTo(x*.58,y*.58);g.lineTo(x,y);g.strokePath();
      g.lineStyle(2,0x8e8264,.85);g.beginPath();g.moveTo(x*.58,y*.58);g.lineTo(x*.73-y*.2,y*.73+x*.2);g.strokePath();
    }
    g.fillStyle(0x8f7a58,1);g.fillEllipse(0,0,12,12);
  }

  private drawBoulder(x:number,y:number,radius:number,variant:number):void{
    const g=this.gfx,points:Phaser.Math.Vector2[]=[];
    for(let i=0;i<7;i++){const a=i*Math.PI*2/7,reach=radius*(.78+artHash(i,variant,2)*.22);points.push(new Phaser.Math.Vector2(x+Math.cos(a)*reach,y+Math.sin(a)*reach*.86));}
    g.fillStyle(OVERHEAD.shadow,.14);g.fillEllipse(x+this.shadowX,y+this.shadowY,radius*2,radius*1.68);
    g.fillStyle(0x888a7a,1);g.fillPoints(points,true);
    g.fillStyle(0xb6b5a1,.65);g.fillEllipse(x-radius*.21,y-radius*.23,radius*1.2,radius*.9);
    g.lineStyle(2,0x6c7167,.6);g.beginPath();g.moveTo(x-radius*.35,y+radius*.35);g.lineTo(x+radius*.36,y-radius*.1);g.strokePath();
  }

  private drawPond(variant:number):void{
    const rx=55+variant*9,ry=36+variant*5,g=this.gfx;
    g.fillStyle(OVERHEAD.meadow,.7);g.fillEllipse(0,0,rx*2.30,ry*2.3);
    g.fillStyle(OVERHEAD.sand,.75);g.fillEllipse(0,0,rx*2.10,ry*2.12);
    g.fillStyle(OVERHEAD.water,1);g.fillEllipse(0,0,rx*2,ry*2);
    g.fillStyle(OVERHEAD.waterDeep,.28);g.fillEllipse(7,5,rx*1.45,ry*1.35);
    g.lineStyle(2,OVERHEAD.waterLight,.5);g.strokeEllipse(-3,-2,rx*1.63,ry*1.55);
  }

  private drawCliff(variant:number):void{
    const g=this.gfx,w=75+variant*20,h=38+variant*10;
    g.fillStyle(OVERHEAD.shadow,.15);g.fillEllipse(this.shadowX,this.shadowY,w*1.16,h*1.35);
    for(let i=0;i<4;i++){
      g.fillStyle(i%2?0xaaa28a:0x878a75,1);g.fillEllipse(i*13-w*.3,0,w*.65,h*(1-i*.08));
      g.lineStyle(3,0xd1cbb3,.5);g.beginPath();g.moveTo(i*13-w*.5,-h*.22);g.lineTo(i*13-w*.12,-h*.34);g.strokePath();
    }
  }

  private drawMound(variant:number):void{
    const rx=60+variant*12,ry=38+variant*7,g=this.gfx;
    g.fillStyle(OVERHEAD.shadow,.10);g.fillEllipse(this.shadowX,this.shadowY,rx*2,ry*2);
    g.fillStyle(0x879575,.62);g.fillEllipse(0,0,rx*2,ry*2);
    g.fillStyle(0xabb08a,.42);g.fillEllipse(-rx*.2,-ry*.2,rx,ry);
  }
}
