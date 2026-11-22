// サーバーのルートレイアウトからも読むので "use client" を付けない（クライアント用モジュールの値はサーバーでは参照になり、文字列として使えない）。
export const THEME_STORAGE_KEY = "notefable:theme:v1";

// 静的ページの初回描画前に適用して、ダークモード時の白フラッシュを防ぐ。Cookie・ヘッダーは読まない。
export const THEME_INIT_SCRIPT = `(function(){try{var p=new URLSearchParams(location.search).get("theme");if(p!=="light"&&p!=="dark"&&p!=="system"){p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||"system";}var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=d?"dark":"light";document.documentElement.dataset.theme=r;document.documentElement.style.colorScheme=r;}catch(e){}})();`;
