export function canvasGeometry(rect,project,fit="fill"){
  if(fit==="cover"||fit==="contain"){
    const scale=(fit==="cover"?Math.max:Math.min)(rect.width/project.width,rect.height/project.height);
    return {scaleX:scale,scaleY:scale,offsetX:(rect.width-project.width*scale)/2,offsetY:(rect.height-project.height*scale)/2};
  }
  return {scaleX:rect.width/project.width,scaleY:rect.height/project.height,offsetX:0,offsetY:0};
}
