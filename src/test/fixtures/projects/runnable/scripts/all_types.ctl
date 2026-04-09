// all_types.ctl
// Fixture for variable type display tests.
// Manager -num 6   Mode: once
//
// All WinCC OA CTRL primitive and composite types are declared with known
// values.  A breakpoint at BP_LINE lets the E2E test verify that the debugger
// sidebar (variablesRequest) shows correct values for every type.
//
// BP_LINE = 55  (DebugN "inspect here")
//
// Known values at BP_LINE:
//   vi=42        vui=100      vf=3.14     vd=2.718     vb=true    vs="hello"
//   vdi=[10,20,30]            vds=["alpha","beta","gamma"]
//   vdf=[1.1,2.2,3.3]         vdb=[true,false,true]
//   vddi=[[1,2],[3,4]]        vdds=[["aa","bb"],["cc","dd"]]
//   vm={"key1":"value1","num":99}
//   vany=42

main()
{
  // ── Primitives ─────────────────────────────────────────────────────────────
  int    vi  = 42;
  uint   vui = 100;
  float  vf  = 3.14;
  double vd  = 2.718;
  bool   vb  = true;
  string vs  = "hello";

  // ── 1-D dynamic arrays ────────────────────────────────────────────────────
  dyn_int    vdi = makeDynInt(10, 20, 30);
  dyn_string vds = makeDynString("alpha", "beta", "gamma");
  dyn_float  vdf = makeDynFloat(1.1, 2.2, 3.3);
  dyn_bool   vdb = makeDynBool(true, false, true);

  // ── 2-D dynamic arrays ────────────────────────────────────────────────────
  dyn_dyn_int    vddi;
  dynAppend(vddi, makeDynInt(1, 2));
  dynAppend(vddi, makeDynInt(3, 4));

  dyn_dyn_string vdds;
  dynAppend(vdds, makeDynString("aa", "bb"));
  dynAppend(vdds, makeDynString("cc", "dd"));

  // ── mapping ───────────────────────────────────────────────────────────────
  mapping vm;
  vm["key1"] = "value1";
  vm["num"]  = 99;

  // ── anytype ───────────────────────────────────────────────────────────────
  anytype vany = 42;

  // ── BP target: all vars initialised, inspect here ──────────────────────────
  while (true)
  {
    DebugN("all_types: inspect here");  // line 55 — BP_LINE
    delay(1);
  }
}
