import type { Config } from "@netlify/functions";

// Serves the game page as a downloadable offline HTML file (was index.php?dl=1).
export default async (req: Request) => {
  const page = await fetch(new URL("/index.html", req.url));
  const html = (await page.text()).replace("</head>", "<script>var FS_OFF=1</script></head>");
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": 'attachment; filename="fazber-mafia-offline.html"',
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export const config: Config = {
  path: "/offline",
};
