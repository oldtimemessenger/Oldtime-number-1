import { api } from "./store.js";
import { openCreativeEditor } from "./creative-editor.js";
import { persistCreativeProject, validateProjectSources } from "./creative-content.js";
import { projectScenes } from "./creative-project.js";

// Blast supplies its own destination/recipient rules, not a second editor.
export function openBlastCreative(ctx, { file, initialProject, startCamera = false, caption = "", onSaved, onClose } = {}) {
  return openCreativeEditor({
    esc:ctx.esc,toast:ctx.toast,startCamera,initialProject,caption,saveLabel:"Continue",
    background:file?{media:file,kind:file.type.startsWith("video/")?"video":"photo"}:null,
    onClose,
    onSave:async({project,blobs,active,preview,caption:nextCaption})=>{
      const guard=()=>{if(!active())throw new Error("This editing session has ended.");validateProjectSources(project);};
      const duration=projectScenes(project).reduce((sum,scene)=>sum+scene.duration,0);
      if(duration>60)throw new Error("A video note can be up to 60 seconds. Shorten the video or remove a page.");
      const stored=await persistCreativeProject(project,blobs,guard);
      try {
        const blob=await preview();guard();
        await onSaved({blob,creativeProject:stored.saved,duration,caption:nextCaption});
      }catch(error){await stored.cleanup();throw error;}
    }
  });
}
