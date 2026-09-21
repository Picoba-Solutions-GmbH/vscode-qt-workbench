# Set Up vcpkg with CMake Presets: the Qt kits and vcpkg found (presets/kits.js,
# presets/vcpkg.js), the presets written for them (presets/cmake-presets.js), and the command
# choosing them and writing CMakePresets.json and vcpkg.json.

EXT="$(native_path "${EXT_DIR:-$TEST_DIR/..}")"

# presets_says <JavaScript expression>: its JSON value, with k = presets/kits.js, v = presets/vcpkg.js,
# p = presets/cmake-presets.js, j = json-syntax.js, w = the work folder, rel(path) = the path
# with forward slashes and ${work} for w, and apply(text, merged) = the text with mergePresets' edits.
presets_says() {
  "${RUNTIME[@]}" -e '
    const [ext, w, expr] = process.argv.slice(1);
    const k = require(ext + "/src/presets/kits"), v = require(ext + "/src/presets/vcpkg");
    const p = require(ext + "/src/presets/cmake-presets"), j = require(ext + "/src/json-syntax");
    const rel = (x) => String(x).replace(/\\/g, "/").split(w).join("${work}");
    const apply = (text, merged) => merged.edits.slice().sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), text);
    Promise.resolve().then(() => eval(expr)).then((r) => console.log(JSON.stringify(r)), (e) => console.log("threw " + e.message));
  ' "$EXT" "$(native_path "$WORK")" "$1"
}

# A catalogue of kits, read as each system would.
KITS="$WORK/kits"
rm -rf "$KITS"
GCC13='QT_GCC_MAJOR_VERSION = 13\nQT_GCC_MINOR_VERSION = 1\nQT_GCC_PATCH_VERSION = 0\n'
add_qt_kit "$KITS" 6.11.2 mingw_64 "QT_ARCH = x86_64\nQT.global.disabled_features = static cross_compile\n$GCC13"
add_mingw "$KITS" mingw1310_64
add_qt_kit "$KITS" 6.5.3 mingw_64 'QT_ARCH = x86_64\nQT_GCC_MAJOR_VERSION = 11\nQT_GCC_MINOR_VERSION = 2\nQT_GCC_PATCH_VERSION = 0\n'
add_qt_kit "$KITS" 5.15.2 mingw81_64 'QT_ARCH = x86_64\nQT_GCC_MAJOR_VERSION = 8\nQT_GCC_MINOR_VERSION = 1\nQT_GCC_PATCH_VERSION = 0\n'
add_mingw "$KITS" mingw810_64
add_qt_kit "$KITS" 6.11.2 msvc2022_64 'QT_ARCH = x86_64\n'
add_qt_kit "$KITS" 6.11.2 msvc2022_arm64 'QT_ARCH = arm64\n'
add_qt_kit "$KITS" 6.11.2 llvm-mingw_64 'QT_ARCH = x86_64\nQT_CLANG_MAJOR_VERSION = 17\nQT_CLANG_MINOR_VERSION = 0\nQT_CLANG_PATCH_VERSION = 6\n'
add_qt_kit "$KITS" 6.11.2 android_arm64_v8a 'QT_ARCH = arm64\nQT.global.enabled_features = shared cross_compile\nQT_CLANG_MAJOR_VERSION = 17\n'
add_qt_kit "$KITS" 6.11.2 gcc_64 "QT_ARCH = x86_64\n$GCC13"
add_qt_kit "$KITS" 6.11.2 gcc_arm64 "QT_ARCH = arm64\n$GCC13"
add_qt_kit "$KITS" 6.11.2 macos 'QT_ARCH = arm64 x86_64\nQT_APPLE_CLANG_MAJOR_VERSION = 15\n'
add_qt_kit "$KITS" 6.6.0 gcc_64 "QT_ARCH = x86_64\n$GCC13"
mkdir -p "$KITS/Tools/Ninja" && : > "$KITS/Tools/Ninja/ninja"
VS2026='{"dir":"C:/VS/18","major":18,"year":"2026","name":"Visual Studio Professional 2026","generator":"Visual Studio 18 2026"}'
WIN="{platform: \"win32\", arch: \"x64\", visualStudios: []}"
WIN_VS="{platform: \"win32\", arch: \"x64\", visualStudios: [$VS2026]}"

echo "== which kit is which: MinGW, from the GCC version in its qconfig.pri =="
check "Qt's MinGW kit, with the MinGW it was built with" \
  "$(presets_says 'k.readKit(w + "/kits/6.11.2/mingw_64", '"$WIN"').then((kit) => [kit.id, kit.label, kit.compilerLabel, kit.generator, kit.triplet, rel(kit.compilers.cxx), kit.path.map(rel).join(kit.pathSeparator)])')" \
  '["mingw","Qt 6.11.2 MinGW 64-bit","MinGW 13.1.0","MinGW Makefiles","x64-mingw-dynamic","${work}/kits/Tools/mingw1310_64/bin/g++.exe","${work}/kits/6.11.2/mingw_64/bin;${work}/kits/Tools/mingw1310_64/bin"]'
check "no Visual C++: vcpkg's host tools are built with MinGW too" \
  "$(presets_says 'Promise.all([k.readKit(w + "/kits/6.11.2/mingw_64", '"$WIN"'), k.readKit(w + "/kits/6.11.2/mingw_64", '"$WIN_VS"')]).then((kits) => kits.map((kit) => kit.hostTriplet || null))')" \
  '["x64-mingw-dynamic",null]'
check "its MinGW not installed: says which one to add" \
  "$(presets_says 'k.readKit(w + "/kits/6.5.3/mingw_64", '"$WIN"').then((kit) => rel(kit.problem))')" \
  '"it was built with GCC 11.2.0, and ${work}/kits/Tools/mingw1120_64/bin/gcc.exe is missing: add MinGW 11.2.0 with the Qt Maintenance Tool"'
check "Qt 5: no qt.toolchain.cmake, CMAKE_PREFIX_PATH instead, no qmlls.ini" \
  "$(presets_says 'k.readKit(w + "/kits/5.15.2/mingw81_64", '"$WIN"').then((kit) => { const base = p.presetsFor(kit, { toolchain: "T" }).configurePresets[0]; return [base.name, rel(base.cacheVariables.CMAKE_PREFIX_PATH), Object.keys(base.cacheVariables)]; })')" \
  '["qt5-mingw","${work}/kits/5.15.2/mingw81_64",["CMAKE_C_COMPILER","CMAKE_CXX_COMPILER","CMAKE_TOOLCHAIN_FILE","CMAKE_PREFIX_PATH","VCPKG_TARGET_TRIPLET","VCPKG_HOST_TRIPLET"]]'
check "Qt 6.6 gets no QT_QML_GENERATE_QMLLS_INI, 6.11 does" \
  "$(presets_says 'Promise.all(["6.6.0", "6.11.2"].map((ver) => k.readKit(w + "/kits/" + ver + "/gcc_64", { platform: "linux", arch: "x64", visualStudios: [] }))).then((kits) => kits.map((kit) => kit.qmllsIni))')" \
  '[false,true]'

echo "== a Qt6 whose CMake files are split from its mkspecs, as some Linux distributions install it =="
DISTRO="$WORK/distro-kit"
rm -rf "$DISTRO"
mkdir -p "$DISTRO/qt6/mkspecs" "$DISTRO/qt6/bin"
printf 'QT_VERSION = 6.11.2\nQT_MAJOR_VERSION = 6\nQT_ARCH = x86_64\nQT_GCC_MAJOR_VERSION = 13\nQT_GCC_MINOR_VERSION = 1\nQT_GCC_PATCH_VERSION = 0\n' > "$DISTRO/qt6/mkspecs/qconfig.pri"
: > "$DISTRO/qt6/bin/qtpaths"
mkdir -p "$DISTRO/cmake/Qt6" && : > "$DISTRO/cmake/Qt6/qt.toolchain.cmake"
LINUX='{ platform: "linux", arch: "x64", visualStudios: [] }'
check "found one level up, next to the data folder (as Arch's qt6-base installs it)" \
  "$(presets_says 'k.readKit(w + "/distro-kit/qt6", '"$LINUX"').then((kit) => [kit.problem || null, rel(kit.qtToolchain)])')" \
  '[null,"${work}/distro-kit/cmake/Qt6/qt.toolchain.cmake"]'
rm -rf "$DISTRO/cmake"
check "neither location: says both" \
  "$(presets_says 'k.readKit(w + "/distro-kit/qt6", '"$LINUX"').then((kit) => rel(kit.problem))')" \
  '"it has no qt.toolchain.cmake in lib/cmake/Qt6 or ${work}/distro-kit/cmake/Qt6"'

echo "== MSVC: the newest Visual Studio's generator =="
check "vswhere: newest first, the year from the product line or the name" \
  "$(presets_says 'k.findVisualStudios({ "ProgramFiles(x86)": "C:/PF86" }, "win32", async (exe) => { if (!rel(exe).endsWith("C:/PF86/Microsoft Visual Studio/Installer/vswhere.exe")) throw new Error(exe); return JSON.stringify([
      { installationPath: "C:/VS/2022", installationVersion: "17.12.35527.113", displayName: "Visual Studio Build Tools 2022", catalog: { productLineVersion: "2022" } },
      { installationPath: "C:/VS/18", installationVersion: "18.6.11819.183", displayName: "Visual Studio Professional 2026", catalog: { productLineVersion: "18" } }
    ]); }).then((list) => list.map((vs) => vs.generator))')" \
  '["Visual Studio 18 2026","Visual Studio 17 2022"]'
check "no vswhere, or not Windows: none" \
  "$(presets_says 'Promise.all([k.findVisualStudios({ "ProgramFiles(x86)": "C:/PF86" }, "win32", async () => { throw new Error("ENOENT"); }), k.findVisualStudios({ "ProgramFiles(x86)": "C:/PF86" }, "linux", async () => "[]")])')" \
  '[[],[]]'
check "an MSVC kit builds with the Visual Studio generator, per configuration" \
  "$(presets_says 'k.readKit(w + "/kits/6.11.2/msvc2022_64", '"$WIN_VS"').then((kit) => { const presets = p.presetsFor(kit, { toolchain: "T" }); const base = presets.configurePresets[0]; return [kit.label, base.name, base.generator, base.architecture, base.environment.PATH.replace(/.*\/6.11.2\//, ""), Object.keys(base.cacheVariables), presets.buildPresets]; })')" \
  '["Qt 6.11.2 MSVC 2022 64-bit","qt-msvc","Visual Studio 18 2026",{"value":"x64","strategy":"set"},"msvc2022_64/bin;$penv{PATH}",["CMAKE_TOOLCHAIN_FILE","VCPKG_CHAINLOAD_TOOLCHAIN_FILE","VCPKG_TARGET_TRIPLET","QT_QML_GENERATE_QMLLS_INI"],[{"name":"qt-msvc-debug","configurePreset":"qt-msvc-debug","configuration":"Debug"},{"name":"qt-msvc-release","configurePreset":"qt-msvc-release","configuration":"Release"}]]'
check "an ARM64 MSVC kit" \
  "$(presets_says 'k.readKit(w + "/kits/6.11.2/msvc2022_arm64", '"$WIN_VS"').then((kit) => [kit.id, kit.architecture, kit.triplet])')" \
  '["msvc-arm64","ARM64","arm64-windows"]'
check "an MSVC kit without Visual Studio cannot be used" \
  "$(presets_says 'k.readKit(w + "/kits/6.11.2/msvc2022_64", '"$WIN"').then((kit) => kit.problem)')" \
  '"it needs Visual Studio with the C++ tools, and vswhere found none"'

echo "== kits that cannot be used, and why =="
check "llvm-mingw" "$(presets_says 'k.readKit(w + "/kits/6.11.2/llvm-mingw_64", '"$WIN"').then((kit) => kit.problem)')" \
  '"it was built with Clang (llvm-mingw), and vcpkg builds its MinGW triplets with GCC"'
check "a cross-compiling kit" "$(presets_says 'k.readKit(w + "/kits/6.11.2/android_arm64_v8a", '"$WIN"').then((kit) => kit.problem)')" \
  '"it builds for another system (Android, WebAssembly, iOS...), which needs a vcpkg triplet and toolchain of its own"'
check "a Linux kit on Windows, though GCC built it too" "$(presets_says 'k.readKit(w + "/kits/6.11.2/gcc_64", { platform: "win32", arch: "x64", visualStudios: [] }).then((kit) => kit.problem)')" \
  '"it is no kit for Windows: it has no bin/qtpaths.exe or bin/qmake.exe"'
check "a Windows kit on Linux, and a macOS kit on Linux" \
  "$(presets_says 'Promise.all(["mingw_64", "macos"].map((kit) => k.readKit(w + "/kits/6.11.2/" + kit, { platform: "linux", arch: "x64", visualStudios: [] }))).then((kits) => kits.map((kit) => kit.problem))')" \
  '["it is no kit for linux: it has no bin/qtpaths or bin/qmake","its mkspecs/qconfig.pri names no compiler Qt Workbench can set up on linux"]'
check "all kits in an installation root: usable ones first, newest first" \
  "$(presets_says 'k.findKits([w + "/kits"], '"$WIN_VS"').then((kits) => kits.map((kit) => kit.label + (kit.problem ? " (no)" : "")))')" \
  '["Qt 6.11.2 MinGW 64-bit","Qt 6.11.2 MSVC 2022 64-bit","Qt 6.11.2 MSVC 2022 ARM64","Qt 5.15.2 MinGW 64-bit","Qt 6.11.2 android_arm64_v8a (no)","Qt 6.11.2 gcc_64 (no)","Qt 6.11.2 gcc_arm64 (no)","Qt 6.11.2 llvm-mingw_64 (no)","Qt 6.11.2 macos (no)","Qt 6.6.0 gcc_64 (no)","Qt 6.5.3 MinGW 64-bit (no)"]'

echo "== Linux and macOS =="
check "GCC on Linux, with Qt's Ninja" \
  "$(presets_says 'k.readKit(w + "/kits/6.11.2/gcc_64", { platform: "linux", arch: "x64", visualStudios: [] }).then((kit) => [kit.id, kit.label, kit.generator, kit.triplet, kit.compilers || null, kit.path.map(rel).join(kit.pathSeparator)])')" \
  '["gcc","Qt 6.11.2 GCC 64-bit","Ninja","x64-linux",null,"${work}/kits/6.11.2/gcc_64/bin:${work}/kits/Tools/Ninja"]'
check "GCC on ARM64 Linux" "$(presets_says 'k.readKit(w + "/kits/6.11.2/gcc_arm64", { platform: "linux", arch: "arm64", visualStudios: [] }).then((kit) => [kit.id, kit.triplet])')" \
  '["gcc-arm64","arm64-linux"]'
check "macOS: the triplet of the Mac's processor" \
  "$(presets_says 'Promise.all(["arm64", "x64"].map((arch) => k.readKit(w + "/kits/6.11.2/macos", { platform: "darwin", arch, visualStudios: [] }))).then((kits) => kits.map((kit) => kit.id + " " + kit.label + " " + kit.triplet))')" \
  '["macos Qt 6.11.2 macOS arm64-osx","macos Qt 6.11.2 macOS x64-osx"]'

echo "== where kits and vcpkg are looked for =="
check "the Qt extension's root, else the installer's; its additional Qt paths name qmake or qtpaths" \
  "$(presets_says '[
      k.qtSearchPaths({ installationRoot: "", additionalQtPaths: ["C:/Qt/6.8.0/msvc2022_64/bin/qtpaths.exe", { path: "D:/Qt6/6.9.0/mingw_64" }], env: { SystemDrive: "E:" }, platform: "win32" }),
      k.qtSearchPaths({ installationRoot: "D:/Qt", additionalQtPaths: [], env: {}, platform: "win32" }),
      k.qtSearchPaths({ installationRoot: "", additionalQtPaths: [], env: {}, platform: "linux", home: "/home/me" })
    ].map((dirs) => dirs.map(rel))')" \
  '[["E:/Qt","C:/Qt/6.8.0/msvc2022_64","D:/Qt6/6.9.0/mingw_64"],["D:/Qt"],["/home/me/Qt"]]'
prepare_qt_install
add_vcpkg "$WORK/proj/vcpkg"
check "CMAKE_TOOLCHAIN_FILE: in the project, VCPKG_ROOT, anywhere else" \
  "$(presets_says '[
      v.toolchainPath(w + "/proj/vcpkg", w + "/proj", {}),
      v.toolchainPath(w + "/vcpkg", w + "/proj", { VCPKG_ROOT: w + "/vcpkg/" }),
      rel(v.toolchainPath(w + "/vcpkg", w + "/proj", {}))
    ]')" \
  '["${sourceDir}/vcpkg/scripts/buildsystems/vcpkg.cmake","$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake","${work}/vcpkg/scripts/buildsystems/vcpkg.cmake"]'
check "vcpkg in existing presets: \${sourceDir} and \$env{} resolved, the unresolvable left out" \
  "$(presets_says 'v.findVcpkgRoots({ projectDir: w + "/proj", env: {}, platform: "linux", visualStudios: [], presetTexts: [JSON.stringify({ configurePresets: [
      { name: "a", toolchainFile: "$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake" },
      { name: "b", cacheVariables: { CMAKE_TOOLCHAIN_FILE: { type: "FILEPATH", value: "${sourceDir}/../vcpkg/scripts/buildsystems/vcpkg.cmake" } } }
    ] }), "not json"] }).then((roots) => roots.map((r) => [rel(r.dir), r.source]))')" \
  '[["${work}/proj/vcpkg","in the project"],["${work}/vcpkg","in the existing presets"]]'

echo "== presets added to an existing CMakePresets.json, laid out like it =="
check "tabs and CRLF kept, version 1 raised to 2, the missing build presets added" \
  "$(presets_says 'apply("{\r\n\t\"version\": 1,\r\n\t\"configurePresets\": [\r\n\t\t{\r\n\t\t\t\"name\": \"mine\"\r\n\t\t}\r\n\t]\r\n}\r\n",
      p.mergePresets("{\r\n\t\"version\": 1,\r\n\t\"configurePresets\": [\r\n\t\t{\r\n\t\t\t\"name\": \"mine\"\r\n\t\t}\r\n\t]\r\n}\r\n", { configurePresets: [{ name: "x", a: { b: 1 } }], buildPresets: [{ name: "x", configurePreset: "x" }] }))')" \
  '"{\r\n\t\"version\": 2,\r\n\t\"configurePresets\": [\r\n\t\t{\r\n\t\t\t\"name\": \"mine\"\r\n\t\t},\r\n\t\t{\r\n\t\t\t\"name\": \"x\",\r\n\t\t\t\"a\": {\r\n\t\t\t\t\"b\": 1\r\n\t\t\t}\r\n\t\t}\r\n\t],\r\n\t\"buildPresets\": [\r\n\t\t{\r\n\t\t\t\"name\": \"x\",\r\n\t\t\t\"configurePreset\": \"x\"\r\n\t\t}\r\n\t]\r\n}\r\n"'
check "empty lists, four spaces" \
  "$(presets_says 'const t = "{\n    \"version\": 6,\n    \"configurePresets\": [],\n    \"buildPresets\": []\n}\n"; apply(t, p.mergePresets(t, { configurePresets: [{ name: "x" }], buildPresets: [{ name: "y" }] }))')" \
  '"{\n    \"version\": 6,\n    \"configurePresets\": [\n        {\n            \"name\": \"x\"\n        }\n    ],\n    \"buildPresets\": [\n        {\n            \"name\": \"y\"\n        }\n    ]\n}\n"'
check "the same preset, keys in another order: unchanged, no edit" \
  "$(presets_says 'const r = p.mergePresets("{\"version\": 3, \"configurePresets\": [{\"inherits\": \"b\", \"name\": \"x\"}], \"buildPresets\": []}", { configurePresets: [{ name: "x", inherits: "b" }], buildPresets: [] }); [r.edits, r.configurePresets]')" \
  '[[],{"added":[],"replaced":[],"unchanged":["x"]}]'
check "a different preset of the same name: replaced where it stands, the new one after it in the same edit" \
  "$(presets_says 'const t = "{\n  \"configurePresets\": [\n    {\"name\": \"x\"}\n  ]\n}"; const r = p.mergePresets(t, { configurePresets: [{ name: "x", hidden: true }, { name: "y" }], buildPresets: [] }); [r.edits.length, r.configurePresets, apply(t, r)]')" \
  '[1,{"added":["y"],"replaced":["x"],"unchanged":[]},"{\n  \"configurePresets\": [\n    {\n      \"name\": \"x\",\n      \"hidden\": true\n    },\n    {\n      \"name\": \"y\"\n    }\n  ]\n}"]'
check "no JSON object of presets: refused" \
  "$(presets_says '[() => p.mergePresets("[]", { configurePresets: [], buildPresets: [] }), () => p.mergePresets("{\"configurePresets\": {}}", { configurePresets: [], buildPresets: [] }), () => j.parseJson("{\n  \"version\": 3,\n}")].map((f) => { try { f(); return "ok"; } catch (e) { return e.message; } })')" \
  '["it holds no JSON object","configurePresets is no list","expected a property name at line 3"]'

echo "== a new CMakePresets.json and vcpkg.json, with VCPKG_ROOT =="
prepare_app views
prepare_qt_install
PROCESS_ENV='{"VCPKG_ROOT":"${work}/vcpkg","ProgramFiles(x86)":"${work}/no-visual-studio"}' set_up_vcpkg "$APP" - "[\"$KIT\",\"\${work}/vcpkg\"]"
check "kits: the usable one, the others with why, Browse" "$(pick_items 1)" "$KIT
-- cannot be used
Qt 6.11.2 android_arm64_v8a
--
\$(folder-opened) Browse..."
check "why the Android kit cannot be used" "$(pick_item 1 'Qt 6.11.2 android_arm64_v8a')" \
  'Qt 6.11.2 android_arm64_v8a | ${work}/Qt/6.11.2/android_arm64_v8a | it builds for another system (Android, WebAssembly, iOS...), which needs a vcpkg triplet and toolchain of its own'
check "vcpkg: VCPKG_ROOT's, used through the variable" "$(pick_item 2 '${work}/vcpkg')" \
  '${work}/vcpkg | VCPKG_ROOT | CMAKE_TOOLCHAIN_FILE: $env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake'
check "both created" "$(grep '^CREATED:' "$LAST")" "CREATED: CMakePresets.json,vcpkg.json"
check "both saved" "$(grep '^SAVED:' "$LAST")" "SAVED: CMakePresets.json,vcpkg.json"
check "CMakePresets.json opened" "$(grep -c '^OPENED: CMakePresets.json:' "$LAST")" "1"
check "presets" "$(json_says "$APP/CMakePresets.json" '[d.version, d.configurePresets.map((p) => p.name + (p.inherits ? " < " + p.inherits : "")), d.buildPresets.map((p) => p.name + " > " + p.configurePreset)]')" \
  "[3,[\"qt-$KIT_ID\",\"qt-$KIT_ID-debug < qt-$KIT_ID\",\"qt-$KIT_ID-release < qt-$KIT_ID\"],[\"qt-$KIT_ID-debug > qt-$KIT_ID-debug\",\"qt-$KIT_ID-release > qt-$KIT_ID-release\"]]"
check "vcpkg.json" "$(cat "$APP/vcpkg.json")" '{
  "$schema": "https://raw.githubusercontent.com/microsoft/vcpkg-tool/main/docs/vcpkg.schema.json",
  "dependencies": []
}'
check "log" "$(grep -c "^  \* CMakePresets.json: created, with configure presets qt-$KIT_ID, qt-$KIT_ID-debug and qt-$KIT_ID-release and build presets qt-$KIT_ID-debug and qt-$KIT_ID-release$" "$LAST")$(grep -c '^  \* vcpkg.json: created, with no dependencies yet$' "$LAST")" "11"
check "notification" "$(grep -c "^\[info\] Qt Workbench: CMakePresets.json builds with $KIT and vcpkg in qt-$KIT_ID-debug and qt-$KIT_ID-release.$" "$LAST")" "1"
check "nothing else changed" "$(changed "$APP")" "2"
if [ "$KIT_ID" = mingw ]; then
  check "the whole file, for MinGW" "$(sed "s#$(native_path "$WORK")#\${work}#g" "$APP/CMakePresets.json")" '{
  "version": 3,
  "cmakeMinimumRequired": {
    "major": 3,
    "minor": 21,
    "patch": 0
  },
  "configurePresets": [
    {
      "name": "qt-mingw",
      "hidden": true,
      "generator": "MinGW Makefiles",
      "binaryDir": "${sourceDir}/builds/${presetName}",
      "environment": {
        "PATH": "${work}/Qt/6.11.2/mingw_64/bin;${work}/Qt/Tools/mingw1310_64/bin;$penv{PATH}"
      },
      "vendor": {
        "qt-cpp": {
          "VSCODE_QT_INSTALLATION": "${work}/Qt/6.11.2/mingw_64"
        }
      },
      "cacheVariables": {
        "CMAKE_C_COMPILER": "${work}/Qt/Tools/mingw1310_64/bin/gcc.exe",
        "CMAKE_CXX_COMPILER": "${work}/Qt/Tools/mingw1310_64/bin/g++.exe",
        "CMAKE_TOOLCHAIN_FILE": "$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake",
        "VCPKG_CHAINLOAD_TOOLCHAIN_FILE": "${work}/Qt/6.11.2/mingw_64/lib/cmake/Qt6/qt.toolchain.cmake",
        "VCPKG_TARGET_TRIPLET": "x64-mingw-dynamic",
        "VCPKG_HOST_TRIPLET": "x64-mingw-dynamic",
        "QT_QML_GENERATE_QMLLS_INI": "ON"
      }
    },
    {
      "name": "qt-mingw-debug",
      "displayName": "Qt 6.11.2 MinGW 64-bit Debug (vcpkg)",
      "description": "Debug build with Qt 6.11.2, MinGW 13.1.0 and vcpkg",
      "inherits": "qt-mingw",
      "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Debug"
      }
    },
    {
      "name": "qt-mingw-release",
      "displayName": "Qt 6.11.2 MinGW 64-bit Release (vcpkg)",
      "description": "Release build with Qt 6.11.2, MinGW 13.1.0 and vcpkg",
      "inherits": "qt-mingw",
      "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Release"
      }
    }
  ],
  "buildPresets": [
    {
      "name": "qt-mingw-debug",
      "configurePreset": "qt-mingw-debug"
    },
    {
      "name": "qt-mingw-release",
      "configurePreset": "qt-mingw-release"
    }
  ]
}'
fi

echo "== the same again: nothing to change =="
commit_changes "$APP" presets
PROCESS_ENV='{"VCPKG_ROOT":"${work}/vcpkg","ProgramFiles(x86)":"${work}/no-visual-studio"}' set_up_vcpkg "$APP" - "[\"$KIT\",\"\${work}/vcpkg\"]"
check "says so" "$(grep -c "^\[info\] Qt Workbench: CMakePresets.json already builds with $KIT and vcpkg.$" "$LAST")" "1"
check "presets already there, logged" "$(grep -c "^  CMakePresets.json: configure presets qt-$KIT_ID, qt-$KIT_ID-debug and qt-$KIT_ID-release already there$" "$LAST")" "1"
check "nothing written" "$(changed "$APP")$(grep '^SAVED:' "$LAST")" "0SAVED: "

echo "== vcpkg in the project: a path relative to it =="
prepare_app views
add_vcpkg "$APP/vcpkg"
commit_changes "$APP" vcpkg
set_up_vcpkg "$APP" . "[\"$KIT\",\"\${work}/app/vcpkg\"]"
check "found in the project" "$(pick_item 2 '${work}/app/vcpkg')" \
  '${work}/app/vcpkg | in the project | CMAKE_TOOLCHAIN_FILE: ${sourceDir}/vcpkg/scripts/buildsystems/vcpkg.cmake'
check "toolchain relative to the project" "$(json_says "$APP/CMakePresets.json" 'd.configurePresets[0].cacheVariables.CMAKE_TOOLCHAIN_FILE')" \
  '"${sourceDir}/vcpkg/scripts/buildsystems/vcpkg.cmake"'

echo "== an existing CMakePresets.json with presets of the same name: replaced when confirmed, the rest kept =="
prepare_app views
prepare_qt_install
cat > "$APP/CMakePresets.json" <<EOF
{
  "version": 3,
  "cmakeMinimumRequired": {
    "major": 3,
    "minor": 21,
    "patch": 0
  },
  "configurePresets": [
    {
      "name": "base-qt-vcpkg",
      "hidden": true,
      "binaryDir": "\${sourceDir}/builds/\${presetName}",
      "cacheVariables": {
        "CMAKE_TOOLCHAIN_FILE": "$(native_path "$VCPKG")/scripts/buildsystems/vcpkg.cmake"
      }
    },
    {
      "name": "qt-$KIT_ID-debug",
      "inherits": "base-qt-vcpkg",
      "cacheVariables": {
        "CMAKE_BUILD_TYPE": "Debug"
      }
    }
  ],
  "buildPresets": [
    {
      "name": "debug",
      "configurePreset": "qt-$KIT_ID-debug"
    }
  ]
}
EOF
commit_changes "$APP" "own presets"
set_up_vcpkg "$APP" - "[\"$KIT\",\"\${work}/vcpkg\"]" '"answer":"Replace"'
check "vcpkg found in the presets" "$(pick_items 2 | head -1)$(pick_item 2 '${work}/vcpkg' | cut -d'|' -f2)" '${work}/vcpkg in the existing presets '
check "asked first" "$(grep -c "^\[warning\] CMakePresets.json already has presets named qt-$KIT_ID-debug. Replace them?$" "$LAST")" "1"
check "presets: own ones kept, the same-named one replaced where it was, the new ones after" \
  "$(json_says "$APP/CMakePresets.json" '[d.configurePresets.map((p) => p.name + (p.inherits ? " < " + p.inherits : "")), d.buildPresets.map((p) => p.name)]')" \
  "[[\"base-qt-vcpkg\",\"qt-$KIT_ID-debug < qt-$KIT_ID\",\"qt-$KIT_ID\",\"qt-$KIT_ID-release < qt-$KIT_ID\"],[\"debug\",\"qt-$KIT_ID-debug\",\"qt-$KIT_ID-release\"]]"
check "the file up to the replaced preset untouched" "$(head -18 "$APP/CMakePresets.json")" "$(git -C "$APP" show HEAD:CMakePresets.json | head -18)"
check "the replaced preset's first change is its inherits" "$(git -C "$APP" diff HEAD -U0 CMakePresets.json | grep -m1 '^-  ')" '-      "inherits": "base-qt-vcpkg",'
check "log" "$(grep -c "^  CMakePresets.json: configure presets qt-$KIT_ID and qt-$KIT_ID-release added$" "$LAST")$(grep -c "^  CMakePresets.json: configure presets qt-$KIT_ID-debug replaced$" "$LAST")$(grep -c "^  CMakePresets.json: build presets qt-$KIT_ID-debug and qt-$KIT_ID-release added$" "$LAST")" "111"
check "saved, with the new vcpkg.json" "$(grep '^SAVED:' "$LAST")" "SAVED: CMakePresets.json,vcpkg.json"

echo "== the same, declined =="
git -C "$APP" reset -q --hard && git -C "$APP" clean -qfd
set_up_vcpkg "$APP" - "[\"$KIT\",\"\${work}/vcpkg\"]"
check "nothing written" "$(changed "$APP")" "0"
check "logged" "$(grep -c "^  not changed: replacing qt-$KIT_ID-debug was declined$" "$LAST")" "1"

echo "== a CMakePresets.json that is not valid JSON: nothing asked, nothing written =="
printf '{\n  "version": 3,\n}\n' > "$APP/CMakePresets.json"
commit_changes "$APP" broken
set_up_vcpkg "$APP" - "[\"$KIT\",\"\${work}/vcpkg\"]"
check "no questions" "$(grep -c '^PICK:' "$LAST")" "0"
check "says why" "$(grep -c '^\[error\] Qt Workbench: CMakePresets.json cannot be read: expected a property name at line 3. Fix it, then set up vcpkg again.$' "$LAST")" "1"
check "nothing written" "$(changed "$APP")" "0"

echo "== a git-ignored CMakePresets.json is not written =="
prepare_app views
printf 'CMakePresets.json\n' > "$APP/.gitignore"
commit_changes "$APP" ignore
set_up_vcpkg "$APP" - "[\"$KIT\",\"\${work}/vcpkg\"]"
check "refused" "$(grep -c '^\[error\] Qt Workbench: CMakePresets.json is ignored by git or inside a build folder, so it is not written.$' "$LAST")" "1"
check "nothing written" "$(changed "$APP")$(ls "$APP" | grep -c 'CMakePresets\|vcpkg.json')" "00"

echo "== no vcpkg found: browse to one =="
prepare_app views
mkdir -p "$WORK/not-vcpkg"
set_up_vcpkg "$APP" - "[\"$KIT\",\"Browse...\"]" '"browse":["${work}/not-vcpkg"]'
check "offered: Browse, Install and Get vcpkg" "$(pick_items 2)" '$(folder-opened) Browse...
$(cloud-download) Install vcpkg...
$(link-external) Get vcpkg'
check "placeholder" "$(grep '^PICK: No vcpkg' "$LAST")" "PICK: No vcpkg found: browse to its folder, install it, or get it by hand"
check "not a vcpkg folder: refused" "$(grep -c '^\[error\] Qt Workbench: .*/not-vcpkg is no vcpkg folder: it has no .vcpkg-root and scripts/buildsystems/vcpkg.cmake.$' "$LAST")$(changed "$APP")" "10"
set_up_vcpkg "$APP" - "[\"$KIT\",\"Browse...\"]" '"browse":["${work}/vcpkg"]'
check "a vcpkg folder elsewhere: its absolute path" \
  "$(json_says "$APP/CMakePresets.json" 'd.configurePresets[0].cacheVariables.CMAKE_TOOLCHAIN_FILE' | sed "s#$(native_path "$WORK")#\${work}#")" \
  '"${work}/vcpkg/scripts/buildsystems/vcpkg.cmake"'

echo "== no Qt kit found: browse to a Qt version folder =="
prepare_app views
SETTINGS='{"qt-core.qtInstallationRoot":"${work}/NoQt"}' set_up_vcpkg "$APP" - '["Browse...","Browse..."]' '"browse":["${work}/Qt/6.11.2","${work}/vcpkg"]'
check "placeholder" "$(grep '^PICK: No Qt kit' "$LAST")" 'PICK: No Qt kit found in ${work}/NoQt: browse to one'
check "only Browse" "$(pick_items 1)" '$(folder-opened) Browse...'
check "its usable kit" "$(json_says "$APP/CMakePresets.json" 'd.configurePresets[1].displayName')" "\"$KIT Debug (vcpkg)\""

echo "== browsed into a kit's own mkspecs by mistake: the kit folder is found from its parent =="
prepare_app views
KIT_DIR_REL="\${work}${KIT_DIR#$WORK}"
SETTINGS='{"qt-core.qtInstallationRoot":"${work}/NoQt"}' \
  set_up_vcpkg "$APP" - '["Browse...","Browse..."]' "\"browse\":[\"$KIT_DIR_REL/mkspecs\",\"\${work}/vcpkg\"]"
check "its usable kit, found via the parent" "$(json_says "$APP/CMakePresets.json" 'd.configurePresets[1].displayName')" "\"$KIT Debug (vcpkg)\""
check "logged where it was actually browsed, and where it was found instead" \
  "$(grep -c "^  browsed to .*/mkspecs: $KIT\$" "$LAST")$(grep -c "^  found in .*/$(basename "$KIT_DIR") instead\$" "$LAST")" "11"

echo "== a kit that cannot be used: says why, writes nothing =="
prepare_app views
set_up_vcpkg "$APP" - '["Qt 6.11.2 android_arm64_v8a"]'
check "says why" "$(grep -c '^\[error\] Qt Workbench: Qt 6.11.2 android_arm64_v8a cannot be used: it builds for another system' "$LAST")" "1"
check "not asked for vcpkg, nothing written" "$(grep -c '^PICK:' "$LAST")$(changed "$APP")" "10"

echo "== without the Qt extension's setting: where Qt's installer puts Qt =="
SETTINGS='{}' PROCESS_ENV='{"VCPKG_ROOT":"","ProgramFiles(x86)":"${work}/no-visual-studio","SystemDrive":"${work}","HOME":"${work}"}' set_up_vcpkg "$APP" - '[]'
check "found" "$(pick_items 1 | head -1)" "$KIT"
check "Escape: nothing written" "$(changed "$APP")" "0"

echo "== several CMake projects: asks which =="
MULTI="$WORK/multi"
rm -rf "$MULTI" && mkdir -p "$MULTI/a" "$MULTI/b/sub" "$MULTI/c"
printf 'project(a)\n' > "$MULTI/a/CMakeLists.txt"
printf 'project(b)\nadd_subdirectory(sub)\n' > "$MULTI/b/CMakeLists.txt"
printf 'project(sub)\n' > "$MULTI/b/sub/CMakeLists.txt"
printf 'add_library(c c.cpp)\n' > "$MULTI/c/CMakeLists.txt"
commit_all "$MULTI"
set_up_vcpkg "$MULTI" - "[\"b\",\"$KIT\",\"Browse...\"]" '"browse":["${work}/vcpkg"]'
check "the top-level projects" "$(pick_items 1)" 'a
b'
check "the presets go next to its CMakeLists.txt" "$(cd "$MULTI" && git status --porcelain | cut -c4- | sort | tr '\n' ';')" 'b/CMakePresets.json;b/vcpkg.json;'

echo "== run on a folder without a CMakeLists.txt =="
set_up_vcpkg "$APP" views '[]'
check "refused" "$(grep -c '^\[error\] Qt Workbench: views has no CMakeLists.txt, so it is no CMake project.$' "$LAST")" "1"

echo "== from the Qt Project Explorer, on the project =="
prepare_app views
SETTINGS='{"qt-core.qtInstallationRoot":"${work}/Qt"}' PROCESS_ENV='{"VCPKG_ROOT":"${work}/vcpkg","ProgramFiles(x86)":"${work}/no-visual-studio"}' \
  explore "$APP" "[{\"item\":\"Test\"},{\"command\":\"qtWorkbench.projectExplorer.setUpVcpkg\",\"node\":\"Test\",\"picks\":[\"$KIT\",\"\${work}/vcpkg\"]}]"
check "a CMake project node" "$(printed 1 | grep contextValue)" "contextValue: qtCMakeProject"
check "created in its folder" "$(cd "$APP" && git status --porcelain | cut -c4- | sort | tr '\n' ';')" 'CMakePresets.json;vcpkg.json;'
