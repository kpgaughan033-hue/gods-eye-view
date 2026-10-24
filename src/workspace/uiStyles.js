/** Scoped presentation only; inherited application variables keep ordinary themes intact. */
export const workspaceStyles = `
.workspace-ui { position:fixed; inset:0; z-index:2147483000; pointer-events:none; color:var(--text-primary,#e9f0f5); font:16px/1.5 system-ui,sans-serif; }
.workspace-ui * { box-sizing:border-box; }
.workspace-ui [hidden] { display:none!important; }
.workspace-ui button, .workspace-ui input { font:inherit; }
.workspace-ui button { cursor:pointer; padding:.55rem .85rem; border:1px solid #657c90; border-radius:.4rem; background:#263c50; color:#f4f8fc; }
.workspace-ui :focus-visible { outline:3px solid #79d7ed; outline-offset:3px; }
.workspace-ui__highlight { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.workspace-ui__highlight polygon { fill:#79d7ed33; stroke:#b7f1ff; stroke-width:3; }
.workspace-ui__bar { position:absolute; z-index:2; bottom:110px; left:50%; transform:translateX(-50%); display:flex; gap:.5rem; align-items:center; padding:.5rem; border:1px solid #657c90; border-radius:.6rem; background:#142435; max-width:calc(100% - 24px); pointer-events:auto; }
.workspace-ui__surface { position:absolute; inset:0; width:100%; height:100%; background:#111f2e; border:3px solid #79c4d6; transform-origin:0 0; overflow:auto; pointer-events:auto; overscroll-behavior:contain; color:#f0f5f9; }
.workspace-ui__content { max-width:64rem; margin:0 auto; padding:clamp(1rem,4vw,3rem); }
.workspace-ui__nav { display:flex; flex-wrap:wrap; gap:.75rem; align-items:center; justify-content:space-between; }
.workspace-ui h1 { font-size:clamp(1.6rem,4vw,2.5rem); margin:1.5rem 0 .5rem; }
.workspace-ui p { color:#bed0df; }
.workspace-ui form { display:flex; flex-wrap:wrap; gap:.75rem; align-items:end; margin:2rem 0; }
.workspace-ui label { display:flex; gap:.8rem; align-items:center; }
.workspace-ui form label { display:grid; flex:1 1 16rem; gap:.4rem; }
.workspace-ui input[type=text] { width:100%; min-width:0; padding:.7rem; border:1px solid #8297a9; border-radius:.4rem; background:#203549; color:#fff; }
.workspace-ui input[type=checkbox] { width:1.4rem; height:1.4rem; flex:none; accent-color:#79c4d6; }
.workspace-ui ul { padding:0; list-style:none; }
.workspace-ui li { display:flex; gap:1rem; justify-content:space-between; align-items:center; border-top:1px solid #3a536a; padding:1rem 0; }
.workspace-ui li label { flex:1; min-width:0; overflow-wrap:anywhere; }
.workspace-ui li[data-done=true] span { text-decoration:line-through; color:#a4b7c7; }
.workspace-ui__status { min-height:1.5em; }
@media (max-width:600px) { .workspace-ui__bar { font-size:14px; } .workspace-ui__bar span { display:none; } }
`;
