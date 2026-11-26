#if DEBUG
import Foundation

/// Debug fixture 模式下的离线编辑器替身页，按页面类型渲染并响应原生桥契约。
enum FixtureEditorPage {
    static func html(pageId: String, theme: String, language: String) -> String {
        let resolvedTheme = (theme == "dark") ? "dark" : "light"
        let dir = (language == "ar") ? "rtl" : "ltr"
        let quotedId = NoteEmbedScripts.quote(pageId)
        let pages = FixtureCatalog.editorPages.mapValues { page -> JSONValue in
            [
                "title": .string(page.title),
                "icon": page.icon.map(JSONValue.string) ?? .null,
                "kind": .string(page.kind.rawValue),
            ]
        }
        let quotedPages = NoteEmbedScripts.quote(JSONValue.object(pages).encodedString())
        return """
        <!doctype html>
        <html lang="\(language)" dir="\(dir)" data-theme="\(resolvedTheme)">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
        <style>
        :root{--bg:#ffffff;--text:#1c202a;--muted:rgba(28,32,42,.6);--border:rgba(28,32,42,.1);--surface:#f5f6f8;--accent:#2383e2}
        html[data-theme="dark"]{--bg:#131418;--text:#ecedf0;--muted:rgba(236,237,240,.62);--border:rgba(236,237,240,.12);--surface:#1c1f27;--accent:#5ca3f0}
        *{box-sizing:border-box}
        body{margin:0;padding:18px 20px 64px;background:var(--bg);color:var(--text);font:-apple-system-body;font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.65}
        .header{display:flex;align-items:center;gap:10px;margin-bottom:16px}
        .icon{font-size:28px;line-height:1}
        h1{margin:0;font-size:26px;font-weight:700;letter-spacing:-.02em}
        h2{margin:22px 0 8px;font-size:18px;font-weight:650}
        p{margin:8px 0;font-size:16px}
        .meta{color:var(--muted);font-size:13px;margin-bottom:18px}
        .check{display:flex;align-items:flex-start;gap:10px;margin:6px 0;font-size:16px}
        .box{width:18px;height:18px;border-radius:4px;border:1.5px solid var(--border);display:inline-flex;align-items:center;justify-content:center;flex:none;margin-top:4px;font-size:12px}
        .box.done{background:var(--accent);border-color:var(--accent);color:#fff}
        table{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px;background:var(--surface);border-radius:8px;overflow:hidden}
        th,td{padding:9px 10px;border-bottom:1px solid var(--border);text-align:start}
        th{font-weight:600;color:var(--muted)}
        tr:last-child td{border-bottom:none}
        .board{min-height:500px;border:1px solid var(--border);border-radius:12px;background:radial-gradient(circle,var(--border) 1px,transparent 1px) 0 0/16px 16px}
        .board svg{display:block;width:min(100%,460px);margin-inline:auto}
        .slide{aspect-ratio:16/9;display:grid;align-content:center;gap:4px;padding:8%;border-radius:10px;background:#243653;color:#fff}
        .slide h2{margin:0;font-size:clamp(20px,6vw,38px)}
        .slide p{margin:0;font-size:14px;color:#e0ebff}
        .thumbnails{display:flex;gap:8px;margin-top:14px}
        .thumbnails div{flex:1;min-width:0;aspect-ratio:16/9;display:grid;place-items:center;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-size:12px;text-align:center;padding:2px}
        .thumbnails div:first-child{border:2px solid var(--accent)}
        </style>
        </head>
        <body>
        <div class="header"><span class="icon" id="page-icon"></span><h1 id="page-title"></h1></div>
        <main id="page-content"></main>
        <template id="body-\(FixtureCatalog.IDs.tripPage)">
        <div class="meta">Higashiyama &amp; Arashiyama · 2-day walking route</div>
        <h2 id="fx-block-day1">Morning schedule</h2>
        <p>Start at 08:30 near Kiyomizu-michi and follow the stone lanes down through Ninenzaka before crowds pick up.</p>
        <div class="check"><span class="box done">✓</span><span>Book morning express ticket from Osaka</span></div>
        <div class="check"><span class="box"></span><span>Pick up ICOCA transit card at Kyoto Station</span></div>
        <h2>Transit notes</h2>
        <table>
        <thead><tr><th>Stop</th><th>Area</th><th>Walk</th></tr></thead>
        <tbody>
        <tr><td>Kiyomizu-dera</td><td>Higashiyama</td><td>15 min</td></tr>
        <tr><td>Yasaka Shrine</td><td>Gion</td><td>12 min</td></tr>
        <tr><td>Bamboo Grove</td><td>Arashiyama</td><td>20 min</td></tr>
        </tbody>
        </table>
        <p>Keep water and small coins for shrine entry gates along the Philosopher's Path.</p>
        <h2 id="fx-block-day2">Day 2 — Arashiyama</h2>
        <p>Take the first train to Saga-Arashiyama. Walk through the bamboo grove before the main streets get busy, then head back along the river.</p>
        <h2>Morning checkpoints</h2>
        <table>
        <thead><tr><th>Time</th><th>Stop</th><th>Walk</th></tr></thead>
        <tbody>
        <tr><td>08:00</td><td>Saga-Arashiyama Station</td><td>—</td></tr>
        <tr><td>08:25</td><td>Bamboo Grove</td><td>20 min</td></tr>
        <tr><td>09:20</td><td>Tenryū-ji Garden</td><td>10 min</td></tr>
        <tr><td>10:30</td><td>Togetsukyō Bridge</td><td>15 min</td></tr>
        </tbody>
        </table>
        <h2>Lunch by the river</h2>
        <p>Leave an hour for lunch near the bridge. Walk to the station along the quieter north bank if the main road is busy.</p>
        <h2>Rain plan</h2>
        <p>Swap the river walk for a covered market stop. Save the riverside loop for the afternoon if the weather clears.</p>
        <div class="check"><span class="box"></span><span>Check train departure times before leaving lunch</span></div>
        <div class="check"><span class="box"></span><span>Leave a spare hour before the return train</span></div>
        </template>
        <template id="body-\(FixtureCatalog.IDs.packingPage)">
        <div class="meta">Kyoto · Weekend travel</div>
        <h2>Day bag</h2>
        <div class="check"><span class="box done">✓</span><span>Transit card and small coins</span></div>
        <div class="check"><span class="box"></span><span>Water, folding umbrella and portable charger</span></div>
        <h2>Before leaving</h2>
        <p>Save the walking route offline and check the return train.</p>
        </template>
        <template id="body-\(FixtureCatalog.IDs.glassPage)">
        <div class="meta">App notes · Visual review</div>
        <h2>Chat and composer</h2>
        <div class="check"><span class="box done">✓</span><span>Keep the latest reply visible while typing</span></div>
        <div class="check"><span class="box"></span><span>Check the card with an image and an attached page</span></div>
        <h2>Workspace and editor</h2>
        <div class="check"><span class="box"></span><span>Review the editor controls on a locked, shared note</span></div>
        <p>Repeat the review with Reduce Transparency enabled.</p>
        </template>
        <template id="body-whiteboard">
        <div class="board">
        <svg viewBox="0 0 360 440" aria-hidden="true">
          <path d="M180 104v44m0 64v40m0-25H90v25m90-25h90v25" fill="none" stroke="var(--muted)" stroke-width="2"/>
          <rect x="104" y="42" width="152" height="62" rx="12" fill="#dbeafe" stroke="#60a5fa"/>
          <rect x="104" y="148" width="152" height="64" rx="12" fill="#fef3c7" stroke="#f59e0b"/>
          <rect x="31" y="252" width="118" height="58" rx="12" fill="#e0e7ff" stroke="#818cf8"/>
          <rect x="211" y="252" width="118" height="58" rx="12" fill="#ede9fe" stroke="#a78bfa"/>
          <g fill="#1c202a" font-size="15" font-weight="600" text-anchor="middle">
            <text x="180" y="79">Workspace</text><text x="180" y="185">Page types</text>
            <text x="90" y="287">Notes</text><text x="270" y="287">Slides</text>
          </g>
        </svg>
        </div>
        </template>
        <template id="body-slides">
        <div class="slide"><h2>Q4 roadmap</h2><p>Workspace, chat and editor</p></div>
        <div class="thumbnails"><div>1 · Overview</div><div>2 · Workspace</div><div>3 · Editor</div></div>
        </template>
        <script>
        (function(){
          var pages=JSON.parse(\(quotedPages));
          function post(obj){
            if(window.NoteFableNative&&typeof window.NoteFableNative.postMessage==="function"){
              window.NoteFableNative.postMessage(JSON.stringify(obj));
            }
          }
          function reveal(id){
            var block=id&&document.getElementById(id);
            if(block){block.scrollIntoView({block:"start"});}
          }
          function openPage(o){
            if(!o||!o.id){return false;}
            var known=Object.prototype.hasOwnProperty.call(pages,o.id);
            // 目录外的页面（例如流程里新建的笔记）按空白笔记处理，照样回 ready，原生端不会一直等到超时。
            var page=known?pages[o.id]:{title:o.title||"",icon:o.icon||null,kind:o.kind||"note"};
            document.getElementById("page-title").textContent=page.title;
            var icon=document.getElementById("page-icon");
            icon.textContent=page.icon||"";
            icon.hidden=!page.icon;
            var template=known?document.getElementById("body-"+(page.kind==="note"?o.id:page.kind)):null;
            var content=document.getElementById("page-content");
            if(template){content.replaceChildren(template.content.cloneNode(true));}else{content.replaceChildren();}
            window.scrollTo(0,0);
            reveal(o.reveal);
            post({type:"ready",page:{id:o.id,title:page.title,icon:page.icon,kind:page.kind}});
            post({type:"saveState",state:"saved"});
            return true;
          }
          window.notefableEmbed={
            flush:function(reqId){post({type:"flushed",requestId:reqId,ok:true,kept:false});return true;},
            openPage:openPage,
            close:function(){return true;},
            theme:function(v){document.documentElement.setAttribute("data-theme",v==="dark"?"dark":"light");},
            language:function(c){
              document.documentElement.lang=c||"en";
              document.documentElement.dir=(c==="ar")?"rtl":"ltr";
            },
            appIcon:function(){},
            pageUpdated:function(){},
            pageSettings:function(){},
            pageTrashed:function(){},
            reveal:reveal,
            slides:function(){},
            openHistory:function(){}
          };
          var id=\(quotedId);
          if(Object.prototype.hasOwnProperty.call(pages,id)){
            openPage({id:id,reveal:new URLSearchParams(location.search).get("reveal")});
          }else{
            post({type:"missing",id:id});
          }
        })();
        </script>
        </body>
        </html>
        """
    }
}
#endif
