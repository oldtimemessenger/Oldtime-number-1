const isRecord=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);

// Online posts retain only a reference and the user's note, never a content snapshot.
export function getRepostView(post,db) {
  if(!post)return post;
  if(post.cloud)return {...post,reposts:[...(post.reposts||[])],repostNotes:{...(isRecord(post.repostNotes)?post.repostNotes:{})}};
  const entries=post.cloud&&isRecord(db.localRepostsByPost?.[post.id])?db.localRepostsByPost[post.id]:{};
  const notes={...(isRecord(post.repostNotes)?post.repostNotes:{})};
  const authors=new Set(Array.isArray(post.reposts)?post.reposts:[]);
  for(const [author,entry] of Object.entries(entries)){
    if(!isRecord(entry)||typeof entry.note!=="string")continue;
    authors.add(author);
    if(entry.note)notes[author]=entry.note.slice(0,140);
  }
  return {...post,reposts:[...authors],repostNotes:notes};
}
