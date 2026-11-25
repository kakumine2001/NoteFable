#if DEBUG
import Foundation

/// Debug fixture 模式下的本地笔记编辑器替身页：不联网，按查询参数与桥消息渲染逼真笔记内容并响应原生桥契约。
enum FixtureEditorPage {
    static func html(pageId: String, theme: String, language: String) -> String {
        let resolvedTheme = (theme == "dark") ? "dark" : "light"
        let dir = (language == "ar") ? "rtl" : "ltr"
        let quotedId = NoteEmbedScripts.quote(pageId)
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
        </style>
        </head>
        <body>
        <div class="header"><span class="icon">🗺️</span><h1 id="page-title">Kyoto trip plan</h1></div>
        <div class="meta">Higashiyama &amp; Arashiyama · 2-day walking route</div>
        <h2>Morning schedule</h2>
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
        <script>
        (function(){
          var currentId=\(quotedId);
          var currentTitle="Kyoto trip plan";
          function post(obj){
            if(window.NoteFableNative&&typeof window.NoteFableNative.postMessage==="function"){
              window.NoteFableNative.postMessage(JSON.stringify(obj));
            }
          }
          window.notefableEmbed={
            flush:function(reqId){post({type:"flushed",requestId:reqId,ok:true,kept:false});return true;},
            openPage:function(o){
              if(o&&o.id){currentId=String(o.id);}
              var t=document.getElementById("page-title");
              if(t){t.textContent=currentTitle;}
              post({type:"ready",page:{id:currentId,title:currentTitle,icon:"🗺️",kind:"note"}});
              post({type:"saveState",state:"saved"});
              return true;
            },
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
            reveal:function(){},
            slides:function(){},
            openHistory:function(){}
          };
          post({type:"ready",page:{id:currentId,title:currentTitle,icon:"🗺️",kind:"note"}});
          post({type:"saveState",state:"saved"});
        })();
        </script>
        </body>
        </html>
        """
    }
}
#endif
