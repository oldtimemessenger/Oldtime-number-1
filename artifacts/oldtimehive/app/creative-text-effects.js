export const TEXT_PRESETS=["plain","editorial","neon","outline","echo","chrome","gold","extruded"];
export const BLEND_MODES=["source-over","multiply","screen","overlay","soft-light","hard-light","darken","lighten","color-dodge","color-burn","difference","exclusion","hue","saturation","color","luminosity"];
export const PHOTO_PRESETS={
  original:{brightness:100,contrast:100,saturation:100},
  mono:{brightness:100,contrast:115,saturation:0},
  vivid:{brightness:102,contrast:112,saturation:140},
  cinematic:{brightness:94,contrast:135,saturation:75},
  soft:{brightness:110,contrast:88,saturation:85},
  faded:{brightness:108,contrast:78,saturation:70}
};
export function textPreset(name){
  if(!TEXT_PRESETS.includes(name))throw new Error("Choose a text preset.");
  return {textEffect:{name,amount:.6,color:name==="gold"?"#e6b548":"#b51e29"},
    ...(name==="editorial"?{font:"Georgia",fontSize:128,caseStyle:"uppercase",letterSpacing:4}:{}),
    backgroundOn:false};
}
export function paintStyledText(ctx,layer,line,x,y){
  const effect=layer.textEffect||{},name=effect.name,amount=Math.max(0,Math.min(1,Number(effect.amount??.6)));
  if(!TEXT_PRESETS.includes(name)||name==="plain"||name==="editorial"||!amount){ctx.fillText(line,x,y);return;}
  const size=layer.fontSize||64,color=effect.color||"#b51e29";
  ctx.save();ctx.lineJoin="round";
  if(name==="neon"){
    ctx.shadowColor=color;ctx.shadowBlur=amount*size*.55;
    ctx.strokeStyle=color;ctx.lineWidth=1+amount*size*.05;
    ctx.strokeText(line,x,y);ctx.fillText(line,x,y);
    ctx.shadowBlur=amount*size*.16;ctx.fillText(line,x,y);
  }else if(name==="outline"){
    ctx.strokeStyle=color;ctx.lineWidth=1+amount*size*.09;ctx.strokeText(line,x,y);ctx.fillText(line,x,y);
  }else if(name==="echo"){
    const alpha=ctx.globalAlpha;ctx.fillStyle=color;
    for(let i=3;i>0;i--){ctx.globalAlpha=alpha*(.18+(3-i)*.13)*amount;ctx.fillText(line,x+i*size*.08*amount,y+i*size*.05*amount);}
    ctx.globalAlpha=alpha;ctx.fillStyle=layer.color;ctx.fillText(line,x,y);
  }else if(name==="extruded"){
    const depth=Math.max(1,Math.round(amount*size*.3));ctx.fillStyle=color;
    for(let i=depth;i>0;i--)ctx.fillText(line,x+i*.75,y+i);
    ctx.fillStyle=layer.color;ctx.fillText(line,x,y);
  }else{
    const gradient=ctx.createLinearGradient(0,y-size,0,y+size*.15);
    const stops=name==="gold"?[[0,"#62410c"],[.22,color],[.42,"#fff3b8"],[.5,"#9b6a12"],[.65,color],[.83,"#fff5cc"],[1,"#87580e"]]
      :[[0,"#232936"],[.22,"#99a5b7"],[.43,"#fff"],[.51,"#424c5c"],[.62,"#19212c"],[.8,"#e9eef5"],[1,"#798798"]];
    stops.forEach(([offset,value])=>gradient.addColorStop(offset,value));
    ctx.strokeStyle=color;ctx.lineWidth=amount*3;ctx.strokeText(line,x,y);
    ctx.fillStyle=gradient;ctx.shadowColor=color;ctx.shadowBlur=amount*size*.12;ctx.shadowOffsetY=amount*4;
    ctx.fillText(line,x,y);
  }
  ctx.restore();
}
