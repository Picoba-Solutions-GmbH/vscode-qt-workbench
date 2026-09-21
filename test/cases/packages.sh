# vcpkg packages: vcpkg's install database and what it says after an install (vcpkg/), the
# presets it installs for (presets/configure-presets.js), the CMakeLists.txt edits adding a usage
# and taking it out again (vcpkg/cmake-edits.js), the packages in the Qt Project Explorer, and Add
# vcpkg Package... and Remove vcpkg Package... against a fake vcpkg (fake-vcpkg.js). The usage texts
# are those of vcpkg's ports, and the output is vcpkg 2026-07-27's, installing fmt, tinyxml2 and
# utfcpp for x64-mingw-dynamic.

EXT="$(native_path "${EXT_DIR:-$TEST_DIR/..}")"

# vcpkg_says <JavaScript expression>: its JSON value, or a string as it is. u = vcpkg/usage.js,
# i = vcpkg/installed.js, c = vcpkg/cmake-edits.js, p = presets/configure-presets.js, w = the work
# folder, text(name) = the file $WORK/texts/<name>, rel(x) = x with / and ${work}, recipesOf(usage) =
# [label, commands, skipped] of each recipe, edit(text, commands, target, above) = [the text as
# edited, added, present, notes], `target` {name: "app", projectName: "demo"} when left out,
# unedit(texts, commands, keep) = [the text as edited, removed, kept] for each text, and
# unlist(text, ports) = the vcpkg.json text with the ports taken out.
vcpkg_says() {
  "${RUNTIME[@]}" -e '
    const [ext, w, expr] = process.argv.slice(1);
    const fs = require("fs");
    const u = require(ext + "/src/vcpkg/usage"), i = require(ext + "/src/vcpkg/installed");
    const c = require(ext + "/src/vcpkg/cmake-edits"), p = require(ext + "/src/presets/configure-presets");
    const text = (name) => fs.readFileSync(w + "/texts/" + name, "utf8");
    const rel = (x) => String(x).replace(/\\/g, "/").split(w).join("${work}");
    const recipesOf = (usage) => u.recipes(usage).map((r) => [r.label, r.commands.map((x) => x.text), r.skipped]);
    const apply = (t, edits) => edits.slice().sort((a, b) => b.start - a.start).reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), t);
    const edit = (t, commands, target, above) => {
      const r = c.usageEdits(t, commands, target || { name: "app", projectName: "demo" }, above);
      return [apply(t, r.edits), r.added, r.present, r.notes];
    };
    const unedit = (ts, commands, keep) => {
      const all = [].concat(ts);
      return c.usageRemovals(all, commands, keep).map((r, k) => [apply(all[k], r.edits), r.removed, r.kept]);
    };
    const unlist = (t, ports) => apply(t, i.dependencyRemovals(t, ports).edits);
    Promise.resolve().then(() => eval(expr)).then((r) => process.stdout.write(typeof r === "string" ? r : JSON.stringify(r) + "\n"), (e) => console.log("threw " + e.stack));
  ' "$EXT" "$(native_path "$WORK")" "$1"
}

TEXTS="$WORK/texts"
rm -rf "$TEXTS" && mkdir -p "$TEXTS"
cat > "$TEXTS/fmt" <<'EOF'
The package fmt provides CMake targets:

    find_package(fmt CONFIG REQUIRED)
    target_link_libraries(main PRIVATE fmt::fmt)

    # Or use the header-only version
    find_package(fmt CONFIG REQUIRED)
    target_link_libraries(main PRIVATE fmt::fmt-header-only)
EOF
cat > "$TEXTS/install-output" <<'EOF'
Detecting compiler hash for triplet x64-mingw-dynamic...
Compiler found: C:/Qt/Tools/mingw1310_64/bin/x86_64-w64-mingw32-g++.exe
The following packages are already installed:
    fmt:x64-mingw-dynamic@12.2.0#1
  * vcpkg-cmake:x64-windows@2025-08-07
The following packages will be built and installed:
    tinyxml2:x64-mingw-dynamic@11.0.0 -- git+https://github.com/microsoft/vcpkg@642c5abe1171318729a73bdf95ce6c2ca58e079c
Installing 1/1 tinyxml2:x64-mingw-dynamic@11.0.0...
Building tinyxml2:x64-mingw-dynamic@11.0.0...
-- Installing: D:/QT/vcpkg/packages/tinyxml2_x64-mingw-dynamic/share/tinyxml2/copyright
Starting submission of tinyxml2:x64-mingw-dynamic@11.0.0 to 1 binary cache(s) in the background
Installed contents are licensed to you by owners. Microsoft is not responsible for, nor does it grant any licenses to, third-party packages.
Packages installed in this vcpkg installation declare the following licenses:
Zlib
The package fmt provides CMake targets:

    find_package(fmt CONFIG REQUIRED)
    target_link_libraries(main PRIVATE fmt::fmt)

    # Or use the header-only version
    find_package(fmt CONFIG REQUIRED)
    target_link_libraries(main PRIVATE fmt::fmt-header-only)

tinyxml2 provides CMake targets:

  # this is heuristically generated, and may not be correct
  find_package(tinyxml2 CONFIG REQUIRED)
  target_link_libraries(main PRIVATE tinyxml2::tinyxml2)

tinyxml2 provides pkg-config modules:

  # simple, small, C++ XML parser
  tinyxml2

Completed submission of tinyxml2:x64-mingw-dynamic@11.0.0 to 1 binary cache(s) in 90.8 ms
All requested installations completed successfully in: 7.3 s
EOF
cat > "$TEXTS/openssl" <<'EOF'
openssl is compatible with built-in CMake targets:

  find_package(OpenSSL REQUIRED)
  target_link_libraries(main PRIVATE OpenSSL::SSL)
  target_link_libraries(main PRIVATE OpenSSL::Crypto)
EOF
cat > "$TEXTS/gtest" <<'EOF'
The package gtest is compatible with built-in CMake targets:

    enable_testing()

    find_package(GTest CONFIG REQUIRED)
    target_link_libraries(main PRIVATE GTest::gtest GTest::gtest_main GTest::gmock GTest::gmock_main)

    add_test(AllTestsInMain main)
EOF
cat > "$TEXTS/nlohmann-json" <<'EOF'
The package nlohmann-json provides CMake targets:

    find_package(nlohmann_json CONFIG REQUIRED)
    target_link_libraries(main PRIVATE nlohmann_json::nlohmann_json)

The package nlohmann-json can be configured to not provide implicit conversions via a custom triplet file:

    set(nlohmann-json_IMPLICIT_CONVERSIONS OFF)

For more information, see the docs here:

    https://json.nlohmann.me/api/macros/json_use_implicit_conversions/
EOF
cat > "$TEXTS/qcoro" <<'EOF'
qcoro-qt6 provides CMake targets:

    # Generic coroutine types and tools
    find_package(QCoro6Coro CONFIG REQUIRED)
    target_link_libraries(main PRIVATE QCoro6::Coro)

    # Coroutine support for QtNetwork types
    find_package(QCoro6Network CONFIG REQUIRED)
    target_link_libraries(main PRIVATE QCoro6::Network)

You can also use `QCoro` target namespace for transparent
support of both Qt5 and Qt6.
EOF
cat > "$TEXTS/clipper2" <<'EOF'
The package clipper2 can be imported via CMake FindPkgConfig module:

    # Clipper2
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(Clipper2 REQUIRED IMPORTED_TARGET Clipper2)
    target_link_libraries(main PkgConfig::Clipper2)

clipper2 provides CMake targets:

    # Clipper2
    find_package(Clipper2 CONFIG REQUIRED)
    target_link_libraries(main PRIVATE Clipper2::Clipper2)
EOF
cat > "$TEXTS/lua" <<'EOF'
lua provides CMake integration for the C library:

  find_package(Lua REQUIRED)
  target_include_directories(main PRIVATE ${LUA_INCLUDE_DIR})
  target_link_libraries(main PRIVATE ${LUA_LIBRARIES})

lua[cpp] provides a C++ library with exception handling:

  find_package(unofficial-lua)
  target_link_libraries(main PRIVATE unofficial::lua::lua-cpp)
EOF
cat > "$TEXTS/zlib" <<'EOF'
zlib is compatible with built-in CMake targets:

  find_package(ZLIB REQUIRED)
  target_link_libraries(main PRIVATE ZLIB::ZLIB)

zlib provides pkg-config modules:

  # zlib compression library
  zlib
EOF
cat > "$TEXTS/zstr" <<'EOF'
The package zstr is header only and can be used from CMake via:

    find_package(ZLIB REQUIRED)
    target_link_libraries(main PRIVATE ZLIB::ZLIB)

    find_path(ZSTR_INCLUDE_DIRS "zstr.hpp")
    target_include_directories(main PRIVATE ${ZSTR_INCLUDE_DIRS})
EOF
cat > "$TEXTS/blocks" <<'EOF'
The package winonly provides CMake targets:

    find_package(winonly CONFIG REQUIRED)
    if(WIN32)
        target_link_libraries(main PRIVATE winonly::win)
    endif()

Or, on one line spread over three:

    find_package(winonly CONFIG
        REQUIRED)
    target_link_libraries(main PRIVATE
        winonly::all)
EOF

echo "== what vcpkg install says about using a port =="
check "a usage file: vcpkg prints it as it is" \
  "$(vcpkg_says 'u.usageOf("fmt", text("install-output"), text("fmt") + "\n") === text("fmt").trimEnd()')" "true"
check "no usage file: the CMake targets vcpkg found, up to the next heading" \
  "$(vcpkg_says 'u.usageOf("tinyxml2", text("install-output"), null)')" 'tinyxml2 provides CMake targets:

  # this is heuristically generated, and may not be correct
  find_package(tinyxml2 CONFIG REQUIRED)
  target_link_libraries(main PRIVATE tinyxml2::tinyxml2)'
check "nothing printed for the port, or its usage file not in the output: none" \
  "$(vcpkg_says '[u.usageOf("utfcpp", text("install-output"), null), u.usageOf("gtest", text("install-output"), text("gtest"))]')" "[null,null]"
check "output with CRLF line ends" \
  "$(vcpkg_says 'u.usageOf("fmt", text("install-output").replace(/\n/g, "\r\n"), text("fmt")).split("\n").length')" "8"

echo "== the recipes in a usage =="
check "a library or its header-only version: two recipes, labelled" "$(vcpkg_says 'recipesOf(text("fmt"))')" \
  '[["The package fmt provides CMake targets",["find_package(fmt CONFIG REQUIRED)","target_link_libraries(main PRIVATE fmt::fmt)"],[]],["Or use the header-only version",["find_package(fmt CONFIG REQUIRED)","target_link_libraries(main PRIVATE fmt::fmt-header-only)"],[]]]'
check "the CMake targets vcpkg found: one recipe" "$(vcpkg_says 'recipesOf(u.usageOf("tinyxml2", text("install-output"), null))')" \
  '[["this is heuristically generated, and may not be correct",["find_package(tinyxml2 CONFIG REQUIRED)","target_link_libraries(main PRIVATE tinyxml2::tinyxml2)"],[]]]'
check "two target_link_libraries after one find_package: one recipe" "$(vcpkg_says 'recipesOf(text("openssl")).map((r) => r[1].length)')" "[3]"
check "enable_testing() and add_test(): in the recipe, but skipped" "$(vcpkg_says 'recipesOf(text("gtest"))[0][2]')" '["enable_testing()","add_test(AllTestsInMain main)"]'
check "set() for a triplet file, and a link: no recipe" "$(vcpkg_says 'recipesOf(text("nlohmann-json")).map((r) => r[1])')" \
  '[["find_package(nlohmann_json CONFIG REQUIRED)","target_link_libraries(main PRIVATE nlohmann_json::nlohmann_json)"]]'
check "components, each labelled by its comment" "$(vcpkg_says 'recipesOf(text("qcoro")).map((r) => r[0])')" \
  '["Generic coroutine types and tools","Coroutine support for QtNetwork types"]'
check "pkg-config and CMake targets" "$(vcpkg_says 'recipesOf(text("clipper2")).map((r) => r[1].join("; "))')" \
  '["find_package(PkgConfig REQUIRED); pkg_check_modules(Clipper2 REQUIRED IMPORTED_TARGET Clipper2); target_link_libraries(main PkgConfig::Clipper2)","find_package(Clipper2 CONFIG REQUIRED); target_link_libraries(main PRIVATE Clipper2::Clipper2)"]'
check "include directories and libraries from variables; a heading with a feature" "$(vcpkg_says 'recipesOf(text("lua")).map((r) => [r[0], r[1].length])')" \
  '[["lua provides CMake integration for the C library",3],["lua[cpp] provides a C++ library with exception handling",2]]'
check "one inside if(): no recipe; a command over several lines: on one" "$(vcpkg_says 'recipesOf(text("blocks"))')" \
  '[["Or, on one line spread over three",["find_package(winonly CONFIG REQUIRED)","target_link_libraries(main PRIVATE winonly::all)"],[]]]'

echo "== vcpkg's install database =="
mkdir -p "$TEXTS/db/vcpkg/updates"
cat > "$TEXTS/db/vcpkg/status" <<'EOF'
Package: vcpkg-cmake
Version: 2025-08-07
Architecture: x64-windows
Multi-Arch: same
Status: install ok installed

Package: fmt
Version: 11.0.2
Depends: vcpkg-cmake:x64-windows
Architecture: x64-mingw-dynamic
Description: an older one
  on two lines
Status: install ok installed

Package: zlib
Version: 1.3.1
Architecture: x64-mingw-dynamic
Status: install ok installed
EOF
printf 'Package: fmt\nVersion: 12.2.0\nPort-Version: 1\nDepends: vcpkg-cmake:x64-windows, vcpkg-cmake-config:x64-windows\nArchitecture: x64-mingw-dynamic\nStatus: install ok half-installed\n' > "$TEXTS/db/vcpkg/updates/0000000001"
printf 'Package: fmt\nVersion: 12.2.0\nPort-Version: 1\nDepends: vcpkg-cmake:x64-windows, vcpkg-cmake-config:x64-windows\nArchitecture: x64-mingw-dynamic\nDescription: {fmt} is an open-source formatting library\nStatus: install ok installed\n' > "$TEXTS/db/vcpkg/updates/0000000002"
printf 'Package: curl\nVersion: 8.9.1\nDepends: zlib\nArchitecture: x64-mingw-dynamic\nStatus: install ok installed\n\nPackage: curl\nFeature: ssl\nDepends: openssl\nArchitecture: x64-mingw-dynamic\nStatus: install ok installed\n\nPackage: openssl\nVersion: 3.5.0\nArchitecture: x64-mingw-dynamic\nStatus: install ok half-installed\n\nPackage: zlib\nVersion: 1.3.1\nArchitecture: x64-mingw-dynamic\nStatus: purge ok not-installed\n' > "$TEXTS/db/vcpkg/updates/0000000010"
DB='i.installedPackages(i.databaseFiles(w + "/texts/db", ["0000000010", "0000000002", "0000000001", "notes.txt"]).map((f) => { try { return fs.readFileSync(f, "utf8"); } catch (_) { return ""; } }))'
check "the updates in order after the status file; half-installed and removed ones do not count" \
  "$(vcpkg_says '[...'"$DB"'.keys()]')" '["vcpkg-cmake:x64-windows","fmt:x64-mingw-dynamic","curl:x64-mingw-dynamic"]'
check "a package: version with its port version, dependencies with their triplets" \
  "$(vcpkg_says 'const f = '"$DB"'.get("fmt:x64-mingw-dynamic"); [f.version, f.description, f.depends]')" \
  '["12.2.0#1","{fmt} is an open-source formatting library",["vcpkg-cmake:x64-windows","vcpkg-cmake-config:x64-windows"]]'
check "a feature's paragraph: its name and dependencies; a dependency without a triplet has the package's" \
  "$(vcpkg_says 'const c = '"$DB"'.get("curl:x64-mingw-dynamic"); [c.features, c.depends]')" '[["ssl"],["zlib:x64-mingw-dynamic","openssl:x64-mingw-dynamic"]]'
check "a field on two lines" "$(vcpkg_says 'i.installedPackages([text("db/vcpkg/status")]).get("fmt:x64-mingw-dynamic").description')" 'an older one
on two lines'
check "vcpkg.json's dependencies: names, host, features; no list refused" \
  "$(vcpkg_says '[i.manifestDependencies("{\"dependencies\": [\"fmt\", {\"name\": \"vcpkg-cmake\", \"host\": true}, {\"name\": \"curl\", \"features\": [\"ssl\", {\"name\": \"http2\"}]}]}"), i.manifestDependencies("{}"), (() => { try { return i.manifestDependencies("{\"dependencies\": {}}"); } catch (e) { return e.message; } })()]')" \
  '[[{"name":"fmt","host":false,"features":[]},{"name":"vcpkg-cmake","host":true,"features":[]},{"name":"curl","host":false,"features":["ssl","http2"]}],[],"dependencies is no list"]'
TREE_OF='(roots) => { const shown = (n, d) => [d + n.name + " " + (n.installed ? n.version + (n.host ? " host" : "") + " in " + rel(n.root) : "not installed"), ...n.dependencies.flatMap((x) => shown(x, d + "  "))]; return i.dependencyTree([{ name: "fmt" }, { name: "curl" }, { name: "zlib" }, { name: "snap7" }], roots).flatMap((n) => shown(n, "")); }'
check "the dependency tree: host dependencies marked, the first install folder that has a package decides" \
  "$(vcpkg_says '('"$TREE_OF"')([{ dir: w + "/db", triplet: "x64-mingw-dynamic", packages: '"$DB"' }, { dir: w + "/other", triplet: null, packages: new Map([["zlib:x64-windows", { name: "zlib", triplet: "x64-windows", version: "1.3", features: [], depends: [] }], ["fmt:x64-windows", { name: "fmt", triplet: "x64-windows", version: "10", features: [], depends: [] }]]) }])')" \
  '["fmt 12.2.0#1 in ${work}/db","  vcpkg-cmake 2025-08-07 host in ${work}/db","curl 8.9.1 in ${work}/db","zlib 1.3 in ${work}/other","snap7 not installed"]'
check "a folder whose preset builds for another triplet has none of them" \
  "$(vcpkg_says '('"$TREE_OF"')([{ dir: w + "/db", triplet: "x64-windows", packages: '"$DB"' }])')" \
  '["fmt not installed","curl not installed","zlib not installed","snap7 not installed"]'

echo "== configure presets as CMake resolves them =="
cat > "$TEXTS/CMakePresets.json" <<'EOF'
{
  "version": 3,
  "configurePresets": [
    {
      "name": "base",
      "hidden": true,
      "generator": "Ninja",
      "binaryDir": "${sourceDir}/builds/${presetName}",
      "toolchainFile": "$env{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake",
      "environment": { "PATH": "C:/Qt/bin;$penv{PATH}", "QT_ROOT": "C:/Qt", "QT_BIN": "$env{QT_ROOT}/bin" },
      "cacheVariables": { "VCPKG_TARGET_TRIPLET": "x64-mingw-dynamic", "FLAG": true, "TYPED": { "type": "STRING", "value": "v" } }
    },
    { "name": "debug", "inherits": "base", "cacheVariables": { "CMAKE_BUILD_TYPE": "Debug", "FLAG": null } },
    {
      "name": "other",
      "inherits": ["mine", "base"],
      "binaryDir": "${sourceParentDir}/out/${sourceDirName}",
      "environment": { "QT_ROOT": null, "GEN": "${generator}" }
    },
    {
      "name": "mine",
      "hidden": true,
      "cacheVariables": { "VCPKG_TARGET_TRIPLET": "x64-windows", "VCPKG_HOST_TRIPLET": "x64-windows", "VCPKG_INSTALLED_DIR": "${sourceDir}/../installed" },
      "environment": { "VENDOR": "$vendor{some.vendor}" }
    },
    { "name": "plain", "binaryDir": "${sourceDir}/b" },
    { "name": "cycle", "inherits": "cycle" }
  ]
}
EOF
printf '{"version": 3, "configurePresets": [{"name": "user", "inherits": "debug", "cacheVariables": {"VCPKG_INSTALLED_DIR": "relative/installed"}}, {"name": "debug", "binaryDir": "ignored"}]}\n' > "$TEXTS/CMakeUserPresets.json"
PRESETS='p.configurePresets([{ path: w + "/proj/CMakePresets.json", text: text("CMakePresets.json") }, { path: w + "/proj/CMakeUserPresets.json", text: text("CMakeUserPresets.json") }], w + "/proj", { Path: "C:/Windows", VCPKG_ROOT: w + "/vcpkg" }, "win32")'
check "inherits followed, macros expanded, an unset cache variable and one of CMakeUserPresets.json's same name left out" \
  "$(vcpkg_says 'const d = '"$PRESETS"'.find((x) => x.name === "debug"); [rel(d.binaryDir), rel(d.toolchain), d.generator, d.cacheVariables, d.environment]')" \
  '["${work}/proj/builds/debug","${work}/vcpkg/scripts/buildsystems/vcpkg.cmake","Ninja",{"VCPKG_TARGET_TRIPLET":"x64-mingw-dynamic","TYPED":"v","CMAKE_BUILD_TYPE":"Debug"},{"PATH":"C:/Qt/bin;C:/Windows","QT_ROOT":"C:/Qt","QT_BIN":"C:/Qt/bin"}]'
check "an earlier parent wins; null kept, and $env{} of it is the parent environment's; an unexpandable value left out" \
  "$(vcpkg_says 'const o = '"$PRESETS"'.find((x) => x.name === "other"); [rel(o.binaryDir), o.cacheVariables.VCPKG_TARGET_TRIPLET, o.environment]')" \
  '["${work}/out/proj","x64-windows",{"PATH":"C:/Qt/bin;C:/Windows","QT_ROOT":null,"QT_BIN":"/bin","GEN":"Ninja"}]'
check "what each installs with: vcpkg, triplets, the folder -- VCPKG_INSTALLED_DIR if absolute, else the build folder's vcpkg_installed; a cycle left out" \
  "$(vcpkg_says ''"$PRESETS"'.map((x) => { const v = p.vcpkgOf(x); return x.name + (x.hidden ? " (hidden)" : "") + ": " + (v ? [rel(v.root), v.triplet, v.hostTriplet, v.installRoot && rel(v.installRoot)].join(" ") : "no vcpkg"); })')" \
  '["base (hidden): ${work}/vcpkg x64-mingw-dynamic  ${work}/proj/builds/base/vcpkg_installed","debug: ${work}/vcpkg x64-mingw-dynamic  ${work}/proj/builds/debug/vcpkg_installed","other: ${work}/vcpkg x64-windows x64-windows ${work}/installed","mine (hidden): no vcpkg","plain: no vcpkg","user: ${work}/vcpkg x64-mingw-dynamic  "]'
check "the environment vcpkg runs in: PATH replaced whatever its case, a null variable taken out" \
  "$(vcpkg_says 'const ps = '"$PRESETS"'; const env = { Path: "C:/Windows", QT_ROOT: "D:/Qt", HOME: "h" }; [p.presetEnvironment(ps.find((x) => x.name === "debug"), env, "win32"), p.presetEnvironment(ps.find((x) => x.name === "other"), env, "win32")].map((e) => Object.keys(e).sort().map((k) => k + "=" + e[k]).join(" "))')" \
  '["HOME=h PATH=C:/Qt/bin;C:/Windows QT_BIN=C:/Qt/bin QT_ROOT=C:/Qt","GEN=Ninja HOME=h PATH=C:/Qt/bin;C:/Windows QT_BIN=/bin"]'

echo "== the CMakeLists.txt edits =="
FMT='u.recipes(text("fmt"))[0].commands'
cp "$FIXTURES/qt-app/CMakeLists.txt" "$TEXTS/qt-app.cmake"
vcpkg_says 'edit(text("qt-app.cmake"), '"$FMT"', { name: "appTest", projectName: "Test" })[0]' > "$TEXTS/qt-app.edited"
check "Qt's template: after its find_package(), and after Qt6::Quick on its line" \
  "$(diff "$TEXTS/qt-app.cmake" "$TEXTS/qt-app.edited" | grep '^[<>]')" '> find_package(fmt CONFIG REQUIRED)
<     PRIVATE Qt6::Quick
>     PRIVATE Qt6::Quick fmt::fmt'
check "what was added, as it reads" "$(vcpkg_says 'edit(text("qt-app.cmake"), '"$FMT"', { name: "appTest", projectName: "Test" }).slice(1)')" \
  '[["find_package(fmt CONFIG REQUIRED)","target_link_libraries(appTest PRIVATE fmt::fmt)"],[],[]]'
check "one item per line: on a line of its own, past a comment" \
  "$(vcpkg_says 'edit("project(demo)\nfind_package(Qt6 REQUIRED COMPONENTS Core)\nadd_executable(app main.cpp)\ntarget_link_libraries(app PRIVATE\n    Qt6::Core # the core\n)\n", '"$FMT"')[0]')" \
  'project(demo)
find_package(Qt6 REQUIRED COMPONENTS Core)
find_package(fmt CONFIG REQUIRED)
add_executable(app main.cpp)
target_link_libraries(app PRIVATE
    Qt6::Core # the core
    fmt::fmt
)'
check "no find_package(), no target_link_libraries(), the target as \${PROJECT_NAME}: before it is created, and after the last command naming it" \
  "$(vcpkg_says 'edit("cmake_minimum_required(VERSION 3.16)\nproject(demo)\n\nadd_executable(${PROJECT_NAME} main.cpp)\nset_target_properties(${PROJECT_NAME} PROPERTIES WIN32_EXECUTABLE ON)\ninstall(TARGETS ${PROJECT_NAME})\n", '"$FMT"', { name: "demo", projectName: "demo" })[0]')" \
  'cmake_minimum_required(VERSION 3.16)
project(demo)

find_package(fmt CONFIG REQUIRED)

add_executable(${PROJECT_NAME} main.cpp)
set_target_properties(${PROJECT_NAME} PROPERTIES WIN32_EXECUTABLE ON)

target_link_libraries(${PROJECT_NAME} PRIVATE fmt::fmt)
install(TARGETS ${PROJECT_NAME})'
check "created inside if(): the find before the block" \
  "$(vcpkg_says 'edit("if(WIN32)\n  add_executable(app main.cpp)\nendif()\n", '"$FMT"')[0]')" \
  'find_package(fmt CONFIG REQUIRED)

if(WIN32)
  add_executable(app main.cpp)
endif()

target_link_libraries(app PRIVATE fmt::fmt)'
check "without keywords: the items without PRIVATE, as CMake wants all calls alike" \
  "$(vcpkg_says 'edit("add_executable(app main.cpp)\ntarget_link_libraries(app Qt6::Core)\n", '"$FMT"')[0]')" \
  'find_package(fmt CONFIG REQUIRED)

add_executable(app main.cpp)
target_link_libraries(app Qt6::Core fmt::fmt)'
check "keywords but no PRIVATE: a PRIVATE section, laid out like the last one" \
  "$(vcpkg_says '[edit("add_executable(app main.cpp)\ntarget_link_libraries(app PUBLIC Qt6::Core)\n", '"$FMT"')[0].split("\n")[3], edit("add_executable(app main.cpp)\ntarget_link_libraries(app\n    PUBLIC Qt6::Core\n)\n", '"$FMT"')[0].split("\n").slice(3)]')" \
  '["target_link_libraries(app PUBLIC Qt6::Core PRIVATE fmt::fmt)",["target_link_libraries(app","    PUBLIC Qt6::Core","    PRIVATE fmt::fmt",")",""]]'
check "there already, with other arguments, or in a CMakeLists.txt above: nothing added" \
  "$(vcpkg_says '[edit("find_package(fmt REQUIRED)\nadd_executable(app main.cpp)\ntarget_link_libraries(app PRIVATE fmt::fmt)\n", '"$FMT"').slice(1), edit("add_executable(app main.cpp)\ntarget_link_libraries(app PRIVATE fmt::fmt)\n", '"$FMT"', undefined, ["find_package(fmt 11)\n"]).slice(1)]')" \
  '[[[],["find_package(fmt CONFIG REQUIRED)","target_link_libraries(app PRIVATE fmt::fmt)"],[]],[[],["find_package(fmt CONFIG REQUIRED)","target_link_libraries(app PRIVATE fmt::fmt)"],[]]]'
check "both recipes: one find_package(), both targets" \
  "$(vcpkg_says 'edit("add_executable(app main.cpp)\ntarget_link_libraries(app PRIVATE Qt6::Core)\n", u.recipes(text("fmt")).flatMap((r) => r.commands))[0]')" \
  'find_package(fmt CONFIG REQUIRED)

add_executable(app main.cpp)
target_link_libraries(app PRIVATE Qt6::Core fmt::fmt fmt::fmt-header-only)'
check "include directories in a new command, libraries in the existing one; CRLF kept" \
  "$(vcpkg_says 'JSON.stringify(edit("find_package(Qt6 REQUIRED)\r\nadd_executable(app main.cpp)\r\ntarget_link_libraries(app PRIVATE Qt6::Core)\r\n", u.recipes(text("lua"))[0].commands)[0])')" \
  '"find_package(Qt6 REQUIRED)\r\nfind_package(Lua REQUIRED)\r\nadd_executable(app main.cpp)\r\ntarget_link_libraries(app PRIVATE Qt6::Core ${LUA_LIBRARIES})\r\n\r\ntarget_include_directories(app PRIVATE ${LUA_INCLUDE_DIR})\r\n"'
check "no command names the target: nothing, and why" \
  "$(vcpkg_says 'edit("add_executable(other main.cpp)\n", '"$FMT"').slice(1)')" '[[],[],["no command in it names app"]]'

echo "== taking a usage out of CMakeLists.txt, and a dependency out of vcpkg.json =="
check "every find and target command of a usage, those inside if() too" "$(vcpkg_says 'u.usageCommands(text("blocks")).map((x) => x.text)')" \
  '["find_package(winonly CONFIG REQUIRED)","target_link_libraries(main PRIVATE winonly::win)","find_package(winonly CONFIG REQUIRED)","target_link_libraries(main PRIVATE winonly::all)"]'
UNFMT='u.usageCommands(text("fmt"))'
check "Qt's template with fmt added, fmt taken out again: as it was" \
  "$(vcpkg_says 'const r = unedit(edit(text("qt-app.cmake"), '"$FMT"', { name: "appTest", projectName: "Test" })[0], '"$UNFMT"')[0]; [r[0] === text("qt-app.cmake"), r[1]]')" \
  '[true,["find_package(fmt CONFIG REQUIRED)","fmt::fmt in target_link_libraries(appTest)"]]'
check "each way the usage shows, from any target, inside if() too; a keyword whose items all go goes with them" \
  "$(vcpkg_says 'unedit("find_package(Qt6 REQUIRED COMPONENTS Core)\nfind_package(fmt REQUIRED)\nadd_executable(app main.cpp)\ntarget_link_libraries(app\n    PUBLIC Qt6::Core\n    PRIVATE fmt::fmt\n)\nadd_library(lib STATIC lib.cpp)\nif(WIN32)\n    target_link_libraries(lib PRIVATE Qt6::Core fmt::fmt-header-only)\nendif()\n", '"$UNFMT"')[0][0]')" \
  'find_package(Qt6 REQUIRED COMPONENTS Core)
add_executable(app main.cpp)
target_link_libraries(app
    PUBLIC Qt6::Core
)
add_library(lib STATIC lib.cpp)
if(WIN32)
    target_link_libraries(lib PRIVATE Qt6::Core)
endif()'
check "an item on a line of its own: the line; before the closing parenthesis: the line break too" \
  "$(vcpkg_says '[unedit("target_link_libraries(app PRIVATE\n    Qt6::Core # the core\n    fmt::fmt\n)\n", '"$UNFMT"')[0][0], unedit("target_link_libraries(app PRIVATE\n    Qt6::Core\n    fmt::fmt)\n", '"$UNFMT"')[0][0]]')" \
  '["target_link_libraries(app PRIVATE\n    Qt6::Core # the core\n)\n","target_link_libraries(app PRIVATE\n    Qt6::Core)\n"]'
check "a command left without items goes, with a blank line around it" \
  "$(vcpkg_says 'unedit("add_executable(app main.cpp)\n\ntarget_link_libraries(app PRIVATE fmt::fmt)\n\ninstall(TARGETS app)\n", '"$UNFMT"')[0]')" \
  '["add_executable(app main.cpp)\n\ninstall(TARGETS app)\n",["target_link_libraries(app PRIVATE fmt::fmt)"],[]]'
ZSTR_APP='"find_package(ZLIB REQUIRED)\nfind_path(ZSTR_INCLUDE_DIRS \"zstr.hpp\")\nadd_executable(app main.cpp)\ntarget_link_libraries(app PRIVATE ZLIB::ZLIB)\ntarget_include_directories(app PRIVATE ${ZSTR_INCLUDE_DIRS})\n"'
check "what the usage of a port staying has too stays: zstr goes, zlib stays" \
  "$(vcpkg_says 'unedit('"$ZSTR_APP"', u.usageCommands(text("zstr")), [{ port: "zlib", commands: u.usageCommands(text("zlib")) }])[0]')" \
  '["find_package(ZLIB REQUIRED)\nadd_executable(app main.cpp)\ntarget_link_libraries(app PRIVATE ZLIB::ZLIB)\n",["find_path(ZSTR_INCLUDE_DIRS \"zstr.hpp\")","target_include_directories(app PRIVATE ${ZSTR_INCLUDE_DIRS})"],[["find_package(ZLIB REQUIRED)","zlib, still in vcpkg.json, uses it too"],["ZLIB::ZLIB in target_link_libraries(app)","zlib, still in vcpkg.json, uses it too"]]]'
check "zlib not staying: all of it goes" \
  "$(vcpkg_says 'unedit('"$ZSTR_APP"', u.usageCommands(text("zstr")))[0][0]')" 'add_executable(app main.cpp)'
CLIPPER='"find_package(PkgConfig REQUIRED)\npkg_check_modules(Clipper2 REQUIRED IMPORTED_TARGET Clipper2)\nadd_executable(app main.cpp)\ntarget_link_libraries(app PkgConfig::Clipper2)\nadd_subdirectory(sub)\n"'
check "find_package(PkgConfig) stays while a CMakeLists.txt has a pkg_check_modules() left" \
  "$(vcpkg_says 'unedit(['"$CLIPPER"', "pkg_check_modules(GLIB REQUIRED IMPORTED_TARGET glib-2.0)\n"], u.usageCommands(text("clipper2")))')" \
  '[["find_package(PkgConfig REQUIRED)\nadd_executable(app main.cpp)\nadd_subdirectory(sub)\n",["pkg_check_modules(Clipper2 REQUIRED IMPORTED_TARGET Clipper2)","target_link_libraries(app PkgConfig::Clipper2)"],[["find_package(PkgConfig REQUIRED)","a pkg_check_modules() or pkg_search_module() left needs it"]]],["pkg_check_modules(GLIB REQUIRED IMPORTED_TARGET glib-2.0)\n",[],[]]]'
check "and goes with the last one" \
  "$(vcpkg_says 'unedit('"$CLIPPER"', u.usageCommands(text("clipper2")))[0][0]')" 'add_executable(app main.cpp)
add_subdirectory(sub)'
MANIFEST='"{\n  \"dependencies\": [\n    \"fmt\",\n    {\n      \"name\": \"curl\",\n      \"features\": [\n        \"ssl\"\n      ]\n    },\n    \"zlib\"\n  ]\n}\n"'
check "vcpkg.json: the first, one in the middle, the last, the last two, all -- the rest as written" \
  "$(vcpkg_says '[["fmt"], ["curl"], ["zlib"], ["curl", "zlib"], ["zlib", "fmt", "curl"], ["snap7"]].map((ports) => unlist('"$MANIFEST"', ports).replace(/\n */g, " "))')" \
  '["{ \"dependencies\": [ { \"name\": \"curl\", \"features\": [ \"ssl\" ] }, \"zlib\" ] } ","{ \"dependencies\": [ \"fmt\", \"zlib\" ] } ","{ \"dependencies\": [ \"fmt\", { \"name\": \"curl\", \"features\": [ \"ssl\" ] } ] } ","{ \"dependencies\": [ \"fmt\" ] } ","{ \"dependencies\": [] } ","{ \"dependencies\": [ \"fmt\", { \"name\": \"curl\", \"features\": [ \"ssl\" ] }, \"zlib\" ] } "]'
check "vcpkg.json on one line" "$(vcpkg_says '[unlist("{\"dependencies\": [\"fmt\", \"zlib\"]}", ["fmt"]), unlist("{\"dependencies\": [\"fmt\", \"zlib\"]}", ["zlib"])]')" \
  '["{\"dependencies\": [\"zlib\"]}","{\"dependencies\": [\"fmt\"]}"]'

echo "== the Qt Project Explorer: vcpkg Packages =="
prepare_app views
printf 'vcpkg_installed/\n' > "$APP/.gitignore"
printf '{\n  "dependencies": [\n    "zlib",\n    "fmt",\n    {\n      "name": "snap7"\n    }\n  ]\n}\n' > "$APP/vcpkg.json"
cat > "$APP/CMakePresets.json" <<'EOF'
{
  "version": 3,
  "configurePresets": [
    {
      "name": "qt-mingw",
      "hidden": true,
      "binaryDir": "${sourceDir}/builds/${presetName}",
      "cacheVariables": {
        "CMAKE_TOOLCHAIN_FILE": "${sourceDir}/../vcpkg/scripts/buildsystems/vcpkg.cmake",
        "VCPKG_TARGET_TRIPLET": "x64-mingw-dynamic"
      }
    },
    { "name": "qt-mingw-debug", "inherits": "qt-mingw" },
    { "name": "qt-mingw-release", "inherits": "qt-mingw" }
  ]
}
EOF
DEBUG_DB="$APP/builds/qt-mingw-debug/vcpkg_installed/vcpkg"
mkdir -p "$DEBUG_DB/updates" "$APP/vcpkg_installed/vcpkg"
cat > "$DEBUG_DB/status" <<'EOF'
Package: vcpkg-cmake-config
Version: 2026-07-21
Architecture: x64-windows
Multi-Arch: same
Status: install ok installed

Package: vcpkg-cmake
Version: 2025-08-07
Architecture: x64-windows
Multi-Arch: same
Status: install ok installed

Package: fmt
Version: 12.2.0
Port-Version: 1
Depends: vcpkg-cmake:x64-windows, vcpkg-cmake-config:x64-windows
Architecture: x64-mingw-dynamic
Multi-Arch: same
Description: {fmt} is an open-source formatting library providing a fast and safe alternative to C stdio and C++ iostreams.
Status: install ok installed
EOF
printf 'Package: zlib\nVersion: 1.3.1\nArchitecture: x64-windows\nStatus: install ok installed\n' > "$APP/vcpkg_installed/vcpkg/status"
commit_changes "$APP" vcpkg
explore "$APP" '[{"tree":true},{"item":"Test > vcpkg Packages"},{"item":"Test > vcpkg Packages > fmt"},{"item":"Test > vcpkg Packages > snap7"},{"write":"builds/qt-mingw-debug/vcpkg_installed/vcpkg/updates/0000000000","text":"Package: snap7\nVersion: 1.4.2\nPort-Version: 2\nArchitecture: x64-mingw-dynamic\nStatus: install ok installed\n"},{"tree":true},{"item":"Test > vcpkg Packages > fmt > vcpkg-cmake"}]'
check "the dependencies in vcpkg.json, with what each needs, before the presets" \
  "$(printed 1 | sed -n '/^  vcpkg Packages$/,$p')" '  vcpkg Packages
    fmt  12.2.0#1
      vcpkg-cmake  2025-08-07 · host
      vcpkg-cmake-config  2026-07-21 · host
    snap7  not installed
    zlib  1.3.1
  CMake Presets
    CMakePresets.json
  CMake Modules
    vcpkg.json'
check "the group: where vcpkg installed them -- a build folder, an ignored folder" "$(printed 2)" 'collapsibleState: Collapsed
contextValue: qtVcpkgPackages
icon: package
tooltip: The dependencies in vcpkg.json, as vcpkg installed them in builds/qt-mingw-debug/vcpkg_installed (qt-mingw-debug), vcpkg_installed'
check "an installed package" "$(printed 3)" 'collapsibleState: Collapsed
contextValue: qtVcpkgPackage
icon: package
tooltip: {fmt} is an open-source formatting library providing a fast and safe alternative to C stdio and C++ iostreams.
fmt:x64-mingw-dynamic@12.2.0#1 in builds/qt-mingw-debug/vcpkg_installed'
check "one not installed" "$(printed 4)" 'collapsibleState: None
contextValue: qtVcpkgPackage
icon: package problemsWarningIcon.foreground
tooltip: In vcpkg.json, and not installed in builds/qt-mingw-debug/vcpkg_installed (qt-mingw-debug), vcpkg_installed'
check "read again when vcpkg installs, in a build folder too" "$(printed 6 | grep 'snap7')" "    snap7  1.4.2#2"
check "a package a dependency needs, which is not in vcpkg.json itself: no Remove" "$(printed 7 | grep contextValue)" "contextValue: qtVcpkgDependency"
check "nothing written" "$(changed "$APP" . ':!builds')" "0"
printf '{"dependencies": [}\n' > "$APP/vcpkg.json"
explore "$APP" '[{"tree":true}]'
check "a vcpkg.json that is not valid JSON" "$(printed 1 | grep -A1 'vcpkg Packages')" '  vcpkg Packages  vcpkg.json cannot be read
  CMake Presets'
git -C "$APP" checkout -q vcpkg.json
rm "$APP/vcpkg.json"
explore "$APP" '[{"tree":true}]'
check "no vcpkg.json: no group" "$(printed 1 | grep -c 'vcpkg Packages')" "0"

echo "== Add vcpkg Package... =="
prepare_app views
prepare_qt_install
if ! add_vcpkg_tool "$VCPKG"; then
  echo "  skip: the fake vcpkg needs Node.js as the runtime"
else
add_port "$VCPKG" vcpkg-cmake 2025-08-07 ""
add_port "$VCPKG" vcpkg-cmake-config 2026-07-21 ""
add_port "$VCPKG" fmt 12.2.0 "{fmt} is an open-source formatting library" '[{"name": "vcpkg-cmake", "host": true}, {"name": "vcpkg-cmake-config", "host": true}]'
cp "$TEXTS/fmt" "$VCPKG/ports/fmt/usage"
add_port "$VCPKG" tinyxml2 11.0.0 "A simple, small, efficient, C++ XML parser" '[{"name": "vcpkg-cmake", "host": true}]'
printf 'tinyxml2 tinyxml2::tinyxml2\n' > "$VCPKG/ports/tinyxml2/targets"
add_port "$VCPKG" snap7 1.4.2 "Snap7" '[{"name": "vcpkg-cmake", "host": true}]'
: > "$VCPKG/ports/snap7/fail"
mkdir -p "$VCPKG/versions"
printf '{\n  "default": {\n    "fmt": { "baseline": "12.2.0", "port-version": 1 }\n  }\n}\n' > "$VCPKG/versions/baseline.json"
set_up_vcpkg "$APP" - "[\"$KIT\",\"Browse...\"]" '"browse":["${work}/vcpkg"]'
printf 'builds/\n' > "$APP/.gitignore"
commit_changes "$APP" "vcpkg presets"
TRIPLET="$(json_says "$APP/CMakePresets.json" 'd.configurePresets[0].cacheVariables.VCPKG_TARGET_TRIPLET' | tr -d '"')"
HOST_TRIPLET="$(json_says "$APP/CMakePresets.json" 'd.configurePresets[0].cacheVariables.VCPKG_HOST_TRIPLET || ""' | tr -d '"')"
KIT_BIN="$(json_says "$APP/CMakePresets.json" 'd.configurePresets[0].environment.PATH.split(/[;:](?![\\/])/)[0]' | tr -d '"' | sed "s#$(native_path "$WORK")#\${work}#")"
# A host dependency is marked when vcpkg installed it for another triplet than the package's.
HOST_MARK=" · host"
[ "${HOST_TRIPLET:-x64-windows}" = "$TRIPLET" ] && HOST_MARK=""
# work_log: the extension's log of the last run, with ${work} for the work folder.
work_log() { sed -n '/^===== LOG =====$/,/^===== DIFF =====$/p' "$LAST" | sed "s#$(native_path "$WORK")#\${work}#g"; }
# invocations: how the fake vcpkg ran since its log was emptied, a line each: its arguments, " in ", its working folder.
invocations() {
  "${RUNTIME[@]}" -e 'for (const line of require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(line); console.log(r.args.join(" ") + " in " + r.cwd); }' \
    "$(native_path "$VCPKG/invocations.log")" | sed 's#\\#/#g' | sed "s#$(native_path "$WORK")#\${work}#g"
}
# diff_lines <file>: the lines git sees taken out and put in, without the diff's headers.
diff_lines() { git -C "$APP" diff HEAD -U0 "$1" | grep '^[-+]' | grep -v '^\(---\|+++\) '; }
: > "$VCPKG/invocations.log"

add_package "$APP" "[\"qt-$KIT_ID-debug\",\"tinyxml2\"]"
check "presets building with vcpkg: which to install for" "$(pick_items 1)" "qt-$KIT_ID-debug
qt-$KIT_ID-release"
check "the ports of the vcpkg the presets name, with version and description" "$(awk '/^PICK:/ { i++; next } /^[^ ]/ { if (i == 2) exit } i == 2' "$LAST")" '  fmt | 12.2.0#1 | {fmt} is an open-source formatting library
  snap7 | 1.4.2 | Snap7
  tinyxml2 | 11.0.0 | A simple, small, efficient, C++ XML parser
  vcpkg-cmake | 2025-08-07
  vcpkg-cmake-config | 2026-07-21
  --
  $(edit) Another Port... | of another registry, or an overlay port'
check "one target: not asked" "$(grep -c '^PICK:' "$LAST")" "2"
check "added to vcpkg.json by vcpkg" "$(json_says "$APP/vcpkg.json" 'd.dependencies')" '["tinyxml2"]'
check "vcpkg add port, in the project" "$(invocations | sed -n 1p)" 'add port tinyxml2 --vcpkg-root=${work}/vcpkg in ${work}/app'
check "vcpkg install as a configure with the preset runs it: triplets, the build folder's vcpkg_installed" "$(invocations | sed -n 2p)" \
  "install --triplet=$TRIPLET${HOST_TRIPLET:+ --host-triplet=$HOST_TRIPLET} --vcpkg-root=\${work}/vcpkg --x-wait-for-lock --x-manifest-root=\${work}/app --x-install-root=\${work}/app/builds/qt-$KIT_ID-debug/vcpkg_installed in \${work}/app"
check "in the preset's environment: the kit first on PATH" \
  "$(sed -n 2p "$VCPKG/invocations.log" | "${RUNTIME[@]}" -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).path.split(/[;:](?![\\/])/)[0])' | sed "s#$(native_path "$WORK")#\${work}#g")" "$KIT_BIN"
check "CMakeLists.txt: found and linked, as vcpkg says" "$(diff_lines CMakeLists.txt)" '+find_package(tinyxml2 CONFIG REQUIRED)
-    PRIVATE Qt6::Quick
+    PRIVATE Qt6::Quick tinyxml2::tinyxml2'
check "saved, nothing else changed" "$(grep '^SAVED:' "$LAST")$(changed "$APP")" "SAVED: CMakeLists.txt2"
check "vcpkg's output in the log, as it comes" "$(grep -c '^    Installing 2/2 tinyxml2:' "$LAST")" "1"
check "log" "$(work_log | grep '^  [^ $]')" "  configure preset qt-$KIT_ID-debug: vcpkg \${work}/vcpkg, triplet $TRIPLET${HOST_TRIPLET:+, host triplet $HOST_TRIPLET}, installs into builds/qt-$KIT_ID-debug/vcpkg_installed
  port: tinyxml2, for appTest
  vcpkg.json: tinyxml2 added
  installed: tinyxml2:$TRIPLET@11.0.0
  vcpkg's usage of tinyxml2:
  * CMakeLists.txt: find_package(tinyxml2 CONFIG REQUIRED)
  * CMakeLists.txt: target_link_libraries(appTest PRIVATE tinyxml2::tinyxml2)
  saved 1 file(s)"
check "notification" "$(grep '^\[info\]' "$LAST")" "[info] Qt Workbench: installed tinyxml2 with vcpkg for qt-$KIT_ID-debug, and CMakeLists.txt finds and links it for appTest: find_package(tinyxml2 CONFIG REQUIRED) and target_link_libraries(appTest PRIVATE tinyxml2::tinyxml2)."
commit_changes "$APP" tinyxml2

echo "== from the Qt Project Explorer, on a target; vcpkg shows two ways =="
: > "$VCPKG/invocations.log"
ACTIVE_PRESET="qt-$KIT_ID-release" EXTENSIONS=ms-vscode.cmake-tools SETTINGS='{"qt-core.qtInstallationRoot":"${work}/Qt"}' PROCESS_ENV="$VCPKG_ENV" \
  explore "$APP" '[{"command":"qtWorkbench.projectExplorer.addVcpkgPackage","node":"Test > appTest","picks":["fmt",["fmt::fmt"]]},{"tree":true}]'
check "CMake Tools' active preset: not asked" "$(grep -c "^  qt-$KIT_ID-release: the configure preset active in CMake Tools$" "$LAST")$(invocations | grep -c "^install .*/builds/qt-$KIT_ID-release/vcpkg_installed in ")" "11"
check "the ways vcpkg shows: the first checked" "$(pick_items 2)" '[x] fmt::fmt
[ ] fmt::fmt-header-only'
check "the one chosen" "$(diff_lines CMakeLists.txt)" '+find_package(fmt CONFIG REQUIRED)
-    PRIVATE Qt6::Quick tinyxml2::tinyxml2
+    PRIVATE Qt6::Quick tinyxml2::tinyxml2 fmt::fmt'
check "the tree shows them, installed where each preset had them installed" "$(printed 2 | sed -n '/^  vcpkg Packages$/,/^  CMake Presets$/p')" "  vcpkg Packages
    fmt  12.2.0
      vcpkg-cmake  2025-08-07$HOST_MARK
      vcpkg-cmake-config  2026-07-21$HOST_MARK
    tinyxml2  11.0.0
      vcpkg-cmake  2025-08-07$HOST_MARK
  CMake Presets"
commit_changes "$APP" fmt

echo "== the same again: nothing to add =="
add_package "$APP" "[\"qt-$KIT_ID-debug\",\"tinyxml2\"]"
check "already there, logged" "$(grep -c '^  CMakeLists.txt: find_package(tinyxml2 CONFIG REQUIRED) already there$' "$LAST")$(grep -c '^  CMakeLists.txt: target_link_libraries(appTest PRIVATE tinyxml2::tinyxml2) already there$' "$LAST")$(grep -c '^  vcpkg.json: tinyxml2 was in it already$' "$LAST")" "111"
check "the port is marked in the list" "$(pick_item 2 tinyxml2)" "tinyxml2 | 11.0.0 · in vcpkg.json | A simple, small, efficient, C++ XML parser"
check "nothing written" "$(changed "$APP")$(grep '^SAVED:' "$LAST")" "0SAVED: "
check "notification" "$(grep '^\[info\]' "$LAST")" "[info] Qt Workbench: installed tinyxml2 with vcpkg for qt-$KIT_ID-debug. CMakeLists.txt finds and links it for appTest already."

echo "== vcpkg install fails: vcpkg.json put back =="
add_package "$APP" "[\"qt-$KIT_ID-debug\",\"snap7\"]"
check "says why" "$(grep '^\[error\]' "$LAST")" "[error] Qt Workbench: vcpkg install failed: building snap7:$TRIPLET failed with: BUILD_FAILED. snap7 is taken out of vcpkg.json again, and CMakeLists.txt is not changed."
check "nothing changed" "$(changed "$APP")" "0"
add_package "$APP" "[\"qt-$KIT_ID-debug\",\"Another Port...\"]" '"name":"nosuchport"'
check "a port that does not exist, typed in" "$(grep '^\[error\]' "$LAST")$(changed "$APP")" "[error] Qt Workbench: vcpkg install failed: nosuchport does not exist. nosuchport is taken out of vcpkg.json again, and CMakeLists.txt is not changed.0"
add_package "$APP" "[\"qt-$KIT_ID-debug\",\"Another Port...\"]" '"name":"No_Such"'
check "a name vcpkg does not allow: not run" "$(grep -c '^INVALID: A port name has lower case letters, digits and dashes.$' "$LAST")$(grep -c '\$ vcpkg' "$LAST")" "10"

echo "== Remove vcpkg Package...: out of vcpkg.json and CMakeLists.txt, then uninstalled =="
: > "$VCPKG/invocations.log"
remove_package "$APP" "[\"qt-$KIT_ID-debug\",[\"tinyxml2\"]]" '"answer":"Remove"'
check "presets building with vcpkg: which to uninstall for" "$(pick_items 1)" "qt-$KIT_ID-debug
qt-$KIT_ID-release"
check "the dependencies in vcpkg.json, with what the preset has installed" "$(awk '/^PICK:/ { i++; next } /^[^ ]/ { if (i == 2) exit } i == 2' "$LAST")" '  [ ] fmt | 12.2.0 | {fmt} is an open-source formatting library
  [ ] tinyxml2 | 11.0.0 | A simple, small, efficient, C++ XML parser'
check "asked first, with all it does" "$(work_log | grep '^\[warning\]\|^\[detail\]')" "[warning] Remove the vcpkg package tinyxml2?
[detail] vcpkg.json: tinyxml2 is taken out.
[detail] CMakeLists.txt: find_package(tinyxml2 CONFIG REQUIRED) and tinyxml2::tinyxml2 in target_link_libraries(appTest) are taken out.
[detail] Then vcpkg install uninstalls it from builds/qt-$KIT_ID-debug/vcpkg_installed, for qt-$KIT_ID-debug."
check "vcpkg print-usage of each package installed, while it is, then vcpkg install" "$(invocations | sed 's/ --.*//')" "print-usage fmt:$TRIPLET
print-usage tinyxml2:$TRIPLET
install"
check "print-usage: the package in the preset's install folder" "$(invocations | sed -n 2p)" \
  "print-usage tinyxml2:$TRIPLET --vcpkg-root=\${work}/vcpkg --x-install-root=\${work}/app/builds/qt-$KIT_ID-debug/vcpkg_installed in \${work}/app"
check "taken out of vcpkg.json" "$(json_says "$APP/vcpkg.json" 'd.dependencies')" '["fmt"]'
check "and out of CMakeLists.txt" "$(diff_lines CMakeLists.txt)" '-find_package(tinyxml2 CONFIG REQUIRED)
-    PRIVATE Qt6::Quick tinyxml2::tinyxml2 fmt::fmt
+    PRIVATE Qt6::Quick fmt::fmt'
check "both saved, nothing else changed" "$(grep '^SAVED:' "$LAST")$(changed "$APP")" "SAVED: CMakeLists.txt,vcpkg.json2"
check "vcpkg uninstalled it" "$(grep -c "^    Removing 1/1 tinyxml2:$TRIPLET$" "$LAST")$(ls "$APP/builds/qt-$KIT_ID-debug/vcpkg_installed/$TRIPLET/share" | grep -c '^tinyxml2$')" "10"
check "log" "$(work_log | grep '^  [^ $]')" "  configure preset qt-$KIT_ID-debug: vcpkg \${work}/vcpkg, triplet $TRIPLET${HOST_TRIPLET:+, host triplet $HOST_TRIPLET}, installs into builds/qt-$KIT_ID-debug/vcpkg_installed
  ports: tinyxml2
  vcpkg's usage of tinyxml2:
  * vcpkg.json: tinyxml2 taken out
  * CMakeLists.txt: find_package(tinyxml2 CONFIG REQUIRED) taken out
  * CMakeLists.txt: tinyxml2::tinyxml2 in target_link_libraries(appTest) taken out
  saved 2 file(s)
  uninstalled: tinyxml2:$TRIPLET"
check "notification" "$(grep '^\[info\]' "$LAST")" "[info] Qt Workbench: removed tinyxml2 from vcpkg.json and CMakeLists.txt, and vcpkg uninstalled it for qt-$KIT_ID-debug."
commit_changes "$APP" "tinyxml2 removed"

echo "== from the Qt Project Explorer, on a package: back to before any was added =="
: > "$VCPKG/invocations.log"
ACTIVE_PRESET="qt-$KIT_ID-release" EXTENSIONS=ms-vscode.cmake-tools SETTINGS='{"qt-core.qtInstallationRoot":"${work}/Qt"}' PROCESS_ENV="$VCPKG_ENV" \
  explore "$APP" '[{"command":"qtWorkbench.projectExplorer.removeVcpkgPackage","node":"Test > vcpkg Packages > fmt","answer":"Remove"},{"tree":true}]'
check "the package clicked, for CMake Tools' active preset: nothing to choose" "$(grep -c '^PICK:' "$LAST")$(invocations | grep -c "^install .*/builds/qt-$KIT_ID-release/vcpkg_installed in ")" "01"
# as_before_packages: "same" when vcpkg.json and CMakeLists.txt are byte for byte as Set Up vcpkg left them.
PRESETS_COMMIT="$(git -C "$APP" log --format=%H --grep='^vcpkg presets$')"
as_before_packages() {
  git -C "$APP" diff --quiet "${PRESETS_COMMIT:-none}" -- vcpkg.json CMakeLists.txt 2>/dev/null && echo same || echo differs
}
check "vcpkg.json and CMakeLists.txt as they were before any package was added" "$(as_before_packages)" "same"
check "the tree: no package left" "$(printed 2 | sed -n '/^  vcpkg Packages$/,/^  CMake Presets$/p')" '  vcpkg Packages
  CMake Presets'
check "notification" "$(grep '^\[info\]' "$LAST")" "[info] Qt Workbench: removed fmt from vcpkg.json and CMakeLists.txt, and vcpkg uninstalled it for qt-$KIT_ID-release."
commit_changes "$APP" "fmt removed"

echo "== a package another one needs: what the other's usage has too stays, and so does the package =="
add_port "$VCPKG" zlib 1.3.1 "A compression library" '[]'
cp "$TEXTS/zlib" "$VCPKG/ports/zlib/usage"
add_port "$VCPKG" zstr 1.0.7 "A header-only C++ ZLib wrapper" '["zlib"]'
cp "$TEXTS/zstr" "$VCPKG/ports/zstr/usage"
add_package "$APP" "[\"qt-$KIT_ID-debug\",\"zlib\"]"
add_package "$APP" "[\"qt-$KIT_ID-debug\",\"zstr\",[\"ZLIB::ZLIB\",\"\${ZSTR_INCLUDE_DIRS}\"]]"
check "zlib and zstr added" "$(json_says "$APP/vcpkg.json" 'd.dependencies')$(grep -c 'ZLIB\|ZSTR' "$APP/CMakeLists.txt")" '["zlib","zstr"]4'
commit_changes "$APP" "zlib and zstr"
: > "$VCPKG/invocations.log"
remove_package "$APP" "[\"qt-$KIT_ID-debug\",[\"zlib\"]]" '"answer":"Remove"'
check "asked: CMakeLists.txt keeps what zstr uses too, and vcpkg keeps zlib" "$(work_log | grep '^\[detail\]')" "[detail] vcpkg.json: zlib is taken out.
[detail] CMakeLists.txt keeps find_package(ZLIB REQUIRED): zstr, still in vcpkg.json, uses it too.
[detail] CMakeLists.txt keeps ZLIB::ZLIB in target_link_libraries(appTest): zstr, still in vcpkg.json, uses it too.
[detail] vcpkg keeps zlib installed: zstr needs it."
check "the usage of the package staying read too; no vcpkg install, as it would uninstall nothing" "$(invocations | sed 's/ --.*//')" "print-usage zlib:$TRIPLET
print-usage zstr:$TRIPLET"
check "only vcpkg.json changed" "$(json_says "$APP/vcpkg.json" 'd.dependencies')$(grep '^SAVED:' "$LAST")$(changed "$APP")" '["zstr"]SAVED: vcpkg.json1'
check "notification" "$(grep '^\[info\]' "$LAST")" "[info] Qt Workbench: removed zlib from vcpkg.json. vcpkg keeps zlib installed: zstr needs it."
commit_changes "$APP" "zlib removed"

echo "== a vcpkg without print-usage: the usage file the package installed =="
: > "$VCPKG/invocations.log"
: > "$VCPKG/old"
remove_package "$APP" "[\"qt-$KIT_ID-debug\",[\"zstr\"]]" '"answer":"Remove"'
rm "$VCPKG/old"
check "read instead" "$(work_log | grep 'print-usage zstr')" "  vcpkg print-usage zstr:$TRIPLET failed: invalid command: print-usage: its usage file is read instead"
check "what zlib's usage brought goes too now" "$(work_log | grep '^\[detail\] CMakeLists')" \
  '[detail] CMakeLists.txt: find_package(ZLIB REQUIRED), find_path(ZSTR_INCLUDE_DIRS "zstr.hpp"), ZLIB::ZLIB in target_link_libraries(appTest) and target_include_directories(appTest PRIVATE ${ZSTR_INCLUDE_DIRS}) are taken out.'
check "vcpkg uninstalls zlib with it, as nothing needs it any more" "$(grep '^    Removing' "$LAST")" "    Removing 1/2 zlib:$TRIPLET
    Removing 2/2 zstr:$TRIPLET"
check "vcpkg.json and CMakeLists.txt as they were before any package was added" "$(as_before_packages)" "same"
commit_changes "$APP" "zstr removed"

echo "== packages vcpkg has not installed; cancelled =="
printf '{\n  "dependencies": [\n    "snap7",\n    "zlib"\n  ]\n}\n' > "$APP/vcpkg.json"
commit_changes "$APP" "not installed"
: > "$VCPKG/invocations.log"
remove_package "$APP" "[\"qt-$KIT_ID-debug\",[\"snap7\",\"zlib\"]]"
check "cancelled: nothing changed" "$(grep -c '^  not removed: cancelled$' "$LAST")$(changed "$APP")" "10"
remove_package "$APP" "[\"qt-$KIT_ID-debug\",[\"snap7\",\"zlib\"]]" '"answer":"Remove"'
check "asked" "$(work_log | grep '^\[warning\] Remove\|^\[detail\]')" "[warning] Remove the vcpkg packages snap7 and zlib?
[detail] vcpkg.json: snap7 and zlib are taken out.
[detail] What vcpkg says about using snap7 and zlib is not known, so CMakeLists.txt keeps whatever uses them: the log says why.
[detail] vcpkg has not installed snap7 and zlib for qt-$KIT_ID-debug."
check "vcpkg not run" "$(invocations)" ""
check "taken out of vcpkg.json" "$(cat "$APP/vcpkg.json")" '{
  "dependencies": []
}'
check "why CMakeLists.txt is not changed" "$(work_log | grep '^  !')" "  ! snap7 is not installed in builds/qt-$KIT_ID-debug/vcpkg_installed, so its usage is not known: CMakeLists.txt keeps whatever uses it
  ! zlib is not installed in builds/qt-$KIT_ID-debug/vcpkg_installed, so its usage is not known: CMakeLists.txt keeps whatever uses it"
check "a warning: CMakeLists.txt is for the user to check" "$(grep '^\[warning\] Qt' "$LAST")" \
  "[warning] Qt Workbench: removed snap7 and zlib from vcpkg.json. vcpkg has not installed snap7 and zlib for qt-$KIT_ID-debug. What vcpkg says about using snap7 and zlib is not known, so CMakeLists.txt may still use them: the log says why."
commit_changes "$APP" "none left"

echo "== what it needs first =="
DIRTY=vcpkg.json add_package "$APP" '[]'
check "vcpkg.json with unsaved changes" "$(grep '^\[error\]' "$LAST")" "[error] Qt Workbench: vcpkg.json has unsaved changes, and vcpkg add port writes it. Save it, then add the package again."
DIRTY=vcpkg.json remove_package "$APP" '[]'
check "the same for Remove" "$(grep '^\[error\]' "$LAST")" "[error] Qt Workbench: vcpkg.json has unsaved changes, and removing a package writes it. Save it, then remove the package again."
remove_package "$APP" '[]'
check "Remove: no dependency in vcpkg.json" "$(grep '^\[error\]' "$LAST")" "[error] Qt Workbench: vcpkg.json has no dependencies, so there is no package to remove."
mv "$APP/vcpkg.json" "$APP/vcpkg.json.off"
add_package "$APP" '[]'
check "no vcpkg.json: Set Up vcpkg offered" "$(grep '^\[error\]' "$LAST")" "[error] Qt Workbench: app has no vcpkg.json. Set up vcpkg for it first."
remove_package "$APP" '[]'
check "Remove: no vcpkg.json" "$(grep '^\[error\]' "$LAST")" "[error] Qt Workbench: app has no vcpkg.json, so it has no vcpkg package to remove."
mv "$APP/vcpkg.json.off" "$APP/vcpkg.json"
mv "$APP/CMakePresets.json" "$APP/CMakePresets.json.off"
add_package "$APP" '[]'
check "no preset builds with vcpkg" "$(grep '^\[error\]' "$LAST")" "[error] Qt Workbench: no configure preset of app builds with vcpkg's toolchain file, so where vcpkg installs for the build is not known. Set up vcpkg first."
mv "$APP/CMakePresets.json.off" "$APP/CMakePresets.json"
rm "$VCPKG"/vcpkg*
add_package "$APP" "[\"qt-$KIT_ID-debug\"]"
check "vcpkg not bootstrapped" "$(work_log | grep '^\[error\]' | sed 's/vcpkg\.exe/vcpkg/; s/bootstrap-vcpkg\.bat/bootstrap-vcpkg.sh/')" "[error] Qt Workbench: \${work}/vcpkg has no vcpkg yet. Run bootstrap-vcpkg.sh in it, then add the package again."
check "nothing changed" "$(changed "$APP")" "0"
fi
