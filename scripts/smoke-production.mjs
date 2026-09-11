const baseUrl = (process.env.SMOKE_BASE_URL ?? "https://do4a-blue.vercel.app").replace(/\/$/, "");

const checks = [
  { path: "/login", test: (response) => response.status === 200 },
  ...[
    "/",
    "/tasks",
    "/routine",
    "/schedule",
    "/shifts",
    "/checklists",
    "/checklists/new",
    "/procurement",
    "/payroll",
    "/finances",
    "/cash",
    "/notifications",
    "/admin",
  ].map((path) => ({
    path,
    test: (response) => response.status >= 300 && response.status < 400 && response.headers.get("location")?.includes("/login"),
  })),
];

let failed = false;

for (const check of checks) {
  const response = await fetch(`${baseUrl}${check.path}`, { redirect: "manual" });
  const passed = check.test(response);
  console.log(`${passed ? "PASS" : "FAIL"} ${check.path} -> ${response.status}`);
  if (!passed) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}
