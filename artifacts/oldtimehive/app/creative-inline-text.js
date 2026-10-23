import { textStyle } from "./creative-renderer.js";
import {canvasGeometry} from "./creative-canvas-geometry.js";

// This transparent input supplies the native IME, caret and selection. Canvas
// still paints the actual text; published projects never contain DOM overlays.
export function bindInlineText({ input, done, canvas, project, layer, history, changed }) {
  let editingId = null, composing = false;
  const current = () => project.layers.find(item => item.id === editingId);
  const sync = () => {
    const item = current(); if (!item || input.hidden) return;
    const fit=canvasGeometry(canvas.getBoundingClientRect(),project,getComputedStyle(canvas).objectFit),style=textStyle(item);
    Object.assign(input.style, {
      position:"absolute",left:`${item.x*project.width*fit.scaleX+fit.offsetX}px`,top:`${item.y*project.height*fit.scaleY+fit.offsetY}px`,
      width: `${item.width || 760}px`, minHeight: `${style.lineHeight + 60}px`,
      transform:`translate(-50%,-50%) rotate(${item.rotation}deg) scale(${item.scale*fit.scaleX},${item.scale*fit.scaleY})`,
      transformOrigin: "center", fontFamily: style.family, fontSize: `${item.fontSize || 64}px`,
      fontWeight: item.bold === false ? "400" : "600", fontStyle: item.italic ? "italic" : "normal",
      lineHeight: `${style.lineHeight}px`, letterSpacing: `${item.letterSpacing || 0}px`,
      textAlign: item.align || "center", textTransform: item.caseStyle === "none" ? "none" : item.caseStyle || "none",
      boxSizing: "border-box", padding: "30px", border: "0", outline: "0",
      background: "transparent", color: "transparent", caretColor: item.color || "#fff",
      whiteSpace: "pre-wrap", overflowWrap: "anywhere", touchAction: "manipulation"
    });
  };
  const finish = () => { editingId=null; input.hidden=true; done.hidden=true; input.blur(); changed(); };
  const edit = item => {
    if (item?.kind !== "text" || item.locked) return;
    history.record(); editingId=item.id; input.textContent=item.text;
    input.hidden=false; done.hidden=false; sync(); input.focus({preventScroll:true});
    const range=document.createRange(); range.selectNodeContents(input); range.collapse(false);
    const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  };
  input.oncompositionstart = () => { composing=true; };
  input.oncompositionend = () => { composing=false; input.oninput(); };
  input.oninput = () => {
    const item=current(); if(!item)return;
    item.text=input.innerText.replace(/\r/g,"").slice(0,2200);
    changed(false); sync();
  };
  input.onpaste = event => {
    event.preventDefault(); document.execCommand("insertText",false,event.clipboardData.getData("text/plain").slice(0,2200));
  };
  input.onkeydown = event => { event.stopPropagation(); if(event.key==="Escape"&&!composing){event.preventDefault();finish();} };
  done.onclick=finish;
  return { edit, finish, sync, active: () => !!editingId };
}
