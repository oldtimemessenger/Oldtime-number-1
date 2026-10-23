import { createProject, projectScenes } from "./creative-project.js";

// Multiple gallery items reuse the very same active canvas and tools.
export function bindCreativePages({ q, project, history, changed, seek, setSelected }) {
  let index=0;
  const snapshot=()=>{
    const {pages,activePage,...scene}=project;
    return structuredClone(scene);
  };
  const flush=()=>{
    index=project.activePage||0;
    if(project.pages?.length)project.pages[index]=snapshot();
  };
  const refresh=()=>{
    index=Math.min(project.activePage||0,Math.max(0,(project.pages?.length||1)-1));
    q("pages").replaceChildren();
    projectScenes(project).forEach((_,i)=>{const option=document.createElement("option");option.value=i;option.textContent=`Page ${i+1}`;q("pages").append(option);});
    q("pages").value=index;q("page-tools").hidden=!project.pages?.length;
    const label=project.pages?.length?"Download this page":"Download preview";
    q("export").querySelector(".ce-lbl").textContent=label;q("export").setAttribute("aria-label",label);
  };
  q("pages").onchange=()=>{
    flush();history.record();index=Number(q("pages").value);
    const pages=project.pages;Object.assign(project,structuredClone(pages[index]));project.pages=pages;
    project.activePage=index;
    setSelected(null);seek(0);changed();refresh();
  };
  const append = scene => {
    if(!project.pages?.length)project.pages=[snapshot()];
    flush();project.pages.push(scene);refresh();
  };
  q("remove-page").onclick=()=>{
    if(project.pages?.length<2)return;
    history.record();flush();project.pages.splice(index,1);index=Math.min(index,project.pages.length-1);
    const pages=project.pages;Object.assign(project,structuredClone(pages[index]));project.pages=pages;
    project.activePage=index;
    setSelected(null);seek(0);changed();refresh();
  };
  return {flush,refresh,append,reset:()=>{index=0;refresh();}};
}
