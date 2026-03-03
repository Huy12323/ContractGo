import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

serve(async (req) => {
  const { name } = await req.json().catch(() => ({ name: "World" }));

  return new Response(JSON.stringify({ message: `Hello ${name}!` }), {
    headers: { "Content-Type": "application/json" },
  });
});
