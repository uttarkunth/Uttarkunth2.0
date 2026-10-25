export default async (request: Request, context: { next: () => Promise<Response> }) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/.netlify/") || url.pathname.startsWith("/stays/")) {
    return context.next();
  }
  const response = await context.next();
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") || response.status !== 200) return response;
  let html = await response.text();
  const link = '<a href="/stays/" class="uk-stays-nav-link" aria-label="Explore Uttarkunth Stays">Stays <span aria-hidden="true">↗</span></a>';
  const style = '<style>.uk-stays-nav-link{display:inline-flex!important;align-items:center;gap:5px;background:#164e35!important;color:#fff!important;padding:9px 15px!important;border-radius:999px!important;text-decoration:none!important;font-size:13px!important;font-weight:750!important;line-height:1.3!important;white-space:nowrap!important}.uk-stays-nav-link:hover{background:#236846!important}</style>';
  if (!html.includes('class="uk-stays-nav-link"')) {
    if (/<nav\b[^>]*>[\s\S]*?<\/nav>/i.test(html)) {
      html = html.replace(/<\/nav>/gi, link + '</nav>');
    } else if (/<\/header>/i.test(html)) {
      html = html.replace(/<\/header>/i, '<div style="padding:10px 18px;text-align:right;background:#f7f6ef">' + link + '</div></header>');
    } else {
      html = html.replace(/<body\b[^>]*>/i, '$&<div style="position:fixed;right:16px;top:16px;z-index:99999">' + link + '</div>');
    }
    html = html.replace(/<\/head>/i, style + '</head>');
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};
