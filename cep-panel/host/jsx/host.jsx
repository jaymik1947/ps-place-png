/*
 * 批量置入 PNG 到 PSD  ·  CEP 面板后端（ExtendScript）
 * ------------------------------------------------------------------
 * 这里存放全部 Photoshop 操作，面板通过 evalScript 调用下面四个入口：
 *   PPS_sel()                                   选目录，返回路径
 *   PPS_scan(folderPath)                        扫描配对，返回 JSON
 *   PPS_run(psd, mat, obj, applyAlpha, save)    处理一个 PSD，返回 JSON
 *   PPS_openFolder(folderPath)                  在资源管理器里打开目录
 *
 * 逻辑与 ps-place-png/批量置入PNG到PSD.jsx 一致（那版已实测可用）。
 */

var PPS = {
    MAT_DIR: "mat_2",
    OBJ_DIR: "obj_1",
    PSD_DIR: "rgba",
    MAT_LAYER: "mat",
    OBJ_LAYER: "obj",
    AOV_GROUP: "aov",
    ALPHA_NAME: "alpha"
};

/*
 * CEP 的 evalScript 在 ExtendScript 与面板之间传非 ASCII 字符串会乱码，
 * 所以约定：跨边界只传 ASCII。
 *   路径 / 文件名 → URL 编码后传，面板用 decodeURIComponent 还原
 *   要处理的文件   → 面板只传下标，实际 File 对象缓存在下面
 */
var PPS_cache = {
    folder: "",
    items: []
};

/* ---------------- URL 编解码（ExtendScript 没有内置） ---------------- */

function ppsHex(n) {
    var h = "0123456789ABCDEF";
    return h.charAt((n >> 4) & 15) + h.charAt(n & 15);
}

function ppsUtf8CP(cp) {
    if (cp < 0x80) {
        return "%" + ppsHex(cp);
    }
    if (cp < 0x800) {
        return "%" + ppsHex(0xc0 | (cp >> 6)) + "%" + ppsHex(0x80 | (cp & 0x3f));
    }
    if (cp < 0x10000) {
        return "%" + ppsHex(0xe0 | (cp >> 12)) +
            "%" + ppsHex(0x80 | ((cp >> 6) & 0x3f)) +
            "%" + ppsHex(0x80 | (cp & 0x3f));
    }
    return "%" + ppsHex(0xf0 | (cp >> 18)) +
        "%" + ppsHex(0x80 | ((cp >> 12) & 0x3f)) +
        "%" + ppsHex(0x80 | ((cp >> 6) & 0x3f)) +
        "%" + ppsHex(0x80 | (cp & 0x3f));
}

function ppsEncode(s) {
    if (s === null || s === undefined) return "";
    s = String(s);
    var out = "";
    for (var i = 0; i < s.length; i++) {
        var code = s.charCodeAt(i);
        var c = s.charAt(i);

        if (code < 128) {
            var safe = (code >= 48 && code <= 57) ||
                (code >= 65 && code <= 90) ||
                (code >= 97 && code <= 122) ||
                c === "-" || c === "_" || c === "." || c === "~" ||
                c === "/" || c === ":";
            out += safe ? c : ppsUtf8CP(code);
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
            var low = s.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                out += ppsUtf8CP(0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00));
                i++;
            } else {
                out += ppsUtf8CP(code);
            }
        } else {
            out += ppsUtf8CP(code);
        }
    }
    return out;
}

function ppsDecode(s) {
    if (s === null || s === undefined) return "";
    s = String(s);
    var out = "";
    var i = 0;
    while (i < s.length) {
        if (s.charAt(i) !== "%" || i + 2 >= s.length) {
            out += s.charAt(i);
            i++;
            continue;
        }
        var b1 = parseInt(s.substr(i + 1, 2), 16);
        if (isNaN(b1)) {
            out += s.charAt(i);
            i++;
            continue;
        }
        if (b1 < 0x80) {
            out += String.fromCharCode(b1);
            i += 3;
        } else if ((b1 & 0xe0) === 0xc0 && i + 4 < s.length + 1) {
            var b2 = parseInt(s.substr(i + 4, 2), 16);
            out += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
            i += 6;
        } else if ((b1 & 0xf0) === 0xe0) {
            var c2 = parseInt(s.substr(i + 4, 2), 16);
            var c3 = parseInt(s.substr(i + 7, 2), 16);
            out += String.fromCharCode(((b1 & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
            i += 9;
        } else if ((b1 & 0xf8) === 0xf0) {
            var d2 = parseInt(s.substr(i + 4, 2), 16);
            var d3 = parseInt(s.substr(i + 7, 2), 16);
            var d4 = parseInt(s.substr(i + 10, 2), 16);
            var cp = ((b1 & 0x07) << 18) | ((d2 & 0x3f) << 12) | ((d3 & 0x3f) << 6) | (d4 & 0x3f);
            cp -= 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
            i += 12;
        } else {
            out += s.charAt(i);
            i++;
        }
    }
    return out;
}

/* ---------------- 对外入口 ---------------- */

function PPS_sel() {
    try {
        var f = Folder.selectDialog("请选择父文件夹（内部含 " + PPS.MAT_DIR + " / " + PPS.OBJ_DIR + " / " + PPS.PSD_DIR + "）");
        if (!f) return "";
        PPS_cache.folder = f.fsName;
        return ppsEncode(ppsSlash(f.fsName));
    } catch (e) {
        return "";
    }
}

function PPS_scan(encodedPath) {
    try {
        var folderPath = encodedPath ? ppsDecode(encodedPath) : PPS_cache.folder;
        if (!folderPath) {
            return '{"ok":false,"error":"' + ppsEncode("没有选择文件夹") + '"}';
        }

        var parent = new Folder(folderPath);
        if (!parent.exists) {
            return '{"ok":false,"error":"' + ppsEncode("文件夹不存在") + '"}';
        }
        PPS_cache.folder = parent.fsName;

        var matDir = new Folder(parent.fsName + "/" + PPS.MAT_DIR);
        var objDir = new Folder(parent.fsName + "/" + PPS.OBJ_DIR);
        var psdDir = new Folder(parent.fsName + "/" + PPS.PSD_DIR);

        var matFiles = matDir.exists ? ppsListImages(matDir) : [];
        var objFiles = objDir.exists ? ppsListImages(objDir) : [];
        var psdFiles = psdDir.exists ? ppsListFiles(psdDir, /\.psd$/i) : [];

        var matMap = ppsMakeMap(matFiles);
        var objMap = ppsMakeMap(objFiles);

        PPS_cache.items = [];

        var items = [];
        for (var i = 0; i < psdFiles.length; i++) {
            var p = psdFiles[i];
            var k = ppsKey(p.name);
            var m = matMap[k] || null;
            var o = objMap[k] || null;

            PPS_cache.items.push({ psd: p, mat: m, obj: o });

            items.push(
                '{"idx":' + i +
                ',"name":"' + ppsEncode(p.name) + '"' +
                ',"hasMat":' + (m ? 'true' : 'false') +
                ',"hasObj":' + (o ? 'true' : 'false') + '}'
            );
        }

        return '{"ok":true' +
            ',"folder":"' + ppsEncode(ppsSlash(parent.fsName)) + '"' +
            ',"hasMatDir":' + (matDir.exists ? 'true' : 'false') +
            ',"hasObjDir":' + (objDir.exists ? 'true' : 'false') +
            ',"hasPsdDir":' + (psdDir.exists ? 'true' : 'false') +
            ',"matCount":' + matFiles.length +
            ',"objCount":' + objFiles.length +
            ',"psdCount":' + psdFiles.length +
            ',"items":[' + items.join(',') + ']}';
    } catch (e) {
        return '{"ok":false,"error":"' + ppsEncode(ppsErr(e)) + '"}';
    }
}

function PPS_run(idx, applyAlpha, saveFile) {
    try {
        var n = parseInt(idx, 10);
        if (isNaN(n) || n < 0 || n >= PPS_cache.items.length) {
            return '{"ok":false,"error":"' + ppsEncode("列表已失效，请重新扫描") + '"}';
        }

        var it = PPS_cache.items[n];
        var alphaApplied = ppsProcessOne(
            it.psd,
            it.mat,
            it.obj,
            String(applyAlpha) === "1",
            String(saveFile) === "1"
        );

        return '{"ok":true,"alpha":' + (alphaApplied ? 'true' : 'false') + '}';
    } catch (e) {
        return '{"ok":false,"error":"' + ppsEncode(ppsErr(e)) + '"}';
    }
}

function PPS_openFolder(folderPath) {
    try {
        var f = new Folder(folderPath);
        if (f.exists) f.execute();
    } catch (e) {}
}

/* ---------------- 主处理流程 ---------------- */

function ppsProcessOne(psdFile, matFile, objFile, applyAlpha, saveFile) {
    var oldDialogs = app.displayDialogs;
    var oldUnits = app.preferences.rulerUnits;
    app.displayDialogs = DialogModes.NO;
    app.preferences.rulerUnits = Units.PIXELS;

    var doc = null;
    var alphaApplied = false;
    var matLayer = null;
    var objLayer = null;

    try {
        doc = app.open(psdFile);
        if (!doc) {
            throw new Error("Photoshop 无法打开该 PSD");
        }
        app.activeDocument = doc;

        // 清掉上次留下的同名图层
        ppsRemoveLayersByName(doc, PPS.MAT_LAYER);
        ppsRemoveLayersByName(doc, PPS.OBJ_LAYER);

        // 置入前先把 PSD 的 Alpha 通道应用到背景层
        if (applyAlpha) {
            alphaApplied = ppsApplyAlpha(doc);
        }

        if (matFile) matLayer = ppsPlaceAsLayer(doc, matFile, PPS.MAT_LAYER);
        if (objFile) objLayer = ppsPlaceAsLayer(doc, objFile, PPS.OBJ_LAYER);

        if ((matFile && !matLayer) || (objFile && !objLayer)) {
            throw new Error("有图层置入失败，已放弃保存（原 PSD 未被改动）");
        }

        // 收进 aov 组并隐藏，画面上只留背景层
        ppsGroupIntoAov(doc, matLayer, objLayer);

        if (saveFile) {
            app.activeDocument = doc;
            doc.save();
        }
    } finally {
        if (doc) {
            try {
                doc.close(SaveOptions.DONOTSAVECHANGES);
            } catch (ignoreClose) {}
        }
        app.displayDialogs = oldDialogs;
        try {
            app.preferences.rulerUnits = oldUnits;
        } catch (ignoreUnits) {}
    }

    return alphaApplied;
}

/**
 * 把 mat / obj 收进名为 aov 的组并隐藏该组。
 * 结果：图层面板顶层只有一个隐藏的 aov 组，画面上只显示背景层。
 */
function ppsGroupIntoAov(doc, matLayer, objLayer) {
    if (!matLayer && !objLayer) return;

    ppsRemoveGroupsByName(doc, PPS.AOV_GROUP);

    try {
        app.activeDocument = doc;
        if (matLayer) doc.activeLayer = matLayer;
        else if (objLayer) doc.activeLayer = objLayer;
    } catch (ignoreActive) {}

    var group = null;
    try {
        group = doc.layerSets.add();
    } catch (eAdd) {
        return;
    }
    if (!group) return;

    try {
        group.name = PPS.AOV_GROUP;
    } catch (ignoreName) {}

    if (matLayer) {
        try {
            matLayer.move(group, ElementPlacement.INSIDE);
        } catch (ignoreMoveMat) {}
    }
    if (objLayer) {
        try {
            objLayer.move(group, ElementPlacement.INSIDE);
        } catch (ignoreMoveObj) {}
    }

    // 保证 obj 在 mat 之上
    if (matLayer && objLayer) {
        try {
            objLayer.move(matLayer, ElementPlacement.PLACEBEFORE);
        } catch (ignoreOrder) {}
    }

    // 组隐藏：画面不显示，点开组仍能看到里面的内容
    try {
        group.visible = false;
    } catch (ignoreVis) {}
}

function ppsRemoveGroupsByName(doc, name) {
    for (var i = doc.layers.length - 1; i >= 0; i--) {
        var ly = doc.layers[i];
        if (ly.typename === "LayerSet" && ly.name === name) {
            try {
                ly.remove();
            } catch (ignoreRemove) {}
        }
    }
}

function ppsPlaceAsLayer(destDoc, imgFile, layerName) {
    var srcDoc = null;
    try {
        srcDoc = app.open(imgFile);
        if (!srcDoc) {
            throw new Error("无法打开 " + imgFile.name);
        }

        var srcLayer = srcDoc.activeLayer;

        // 跨文档复制：源文档必须是前台；不能传 insertionLocation，
        // 传了会触发"目标文档必须最前"的校验而报错。
        app.activeDocument = srcDoc;
        var newLayer = srcLayer.duplicate(destDoc);
        app.activeDocument = destDoc;

        if (!newLayer) {
            newLayer = destDoc.activeLayer;
        }
        if (!newLayer) {
            throw new Error("复制图层失败");
        }

        newLayer.name = layerName;

        // 对齐到画布左上角原点
        try {
            var b = newLayer.bounds;
            var left = b[0].as("px");
            var top = b[1].as("px");
            if (Math.abs(left) > 0.01 || Math.abs(top) > 0.01) {
                newLayer.translate(-left, -top);
            }
        } catch (ignoreBounds) {}

        return newLayer;
    } finally {
        if (srcDoc) {
            try {
                srcDoc.close(SaveOptions.DONOTSAVECHANGES);
            } catch (ignoreClose2) {}
        }
    }
}

function ppsApplyAlpha(doc) {
    var channel = ppsFindAlphaChannel(doc);
    if (!channel) return false;

    app.activeDocument = doc;

    var layer = ppsFindTargetLayer(doc);
    if (!layer) {
        throw new Error("找不到可接受 Alpha 的图层");
    }

    try {
        doc.activeLayer = layer;
    } catch (ignoreActive) {}

    // 背景层锁定且不支持透明，先转普通图层
    try {
        if (layer.isBackgroundLayer) {
            layer.isBackgroundLayer = false;
        }
    } catch (ignoreBg) {}

    // 通道载入为选区
    doc.selection.load(channel, SelectionType.REPLACE);

    // 选区为空说明通道全黑，视为没有 Alpha
    var hasSelection = true;
    try {
        var sb = doc.selection.bounds;
        if (sb && sb.length === 4) {
            var selW = sb[2].as("px") - sb[0].as("px");
            var selH = sb[3].as("px") - sb[1].as("px");
            hasSelection = (selW > 0.5 && selH > 0.5);
        }
    } catch (ignoreSelBounds) {
        hasSelection = true;
    }
    if (!hasSelection) {
        try {
            doc.selection.deselect();
        } catch (ignoreDesel2) {}
        return false;
    }

    // 用选区生成图层蒙版；失败则退到直接抠除
    try {
        var desc = new ActionDescriptor();
        var ref = new ActionReference();
        ref.putClass(charIDToTypeID("Chnl"));
        desc.putClass(charIDToTypeID("Nw  "), charIDToTypeID("Chnl"));
        desc.putReference(charIDToTypeID("At  "), ref);
        desc.putEnumerated(charIDToTypeID("Usng"), charIDToTypeID("UsrM"), charIDToTypeID("RvlS"));
        executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
    } catch (eMask) {
        doc.selection.load(channel, SelectionType.REPLACE);
        doc.selection.invert();
        doc.selection.clear();
    }

    try {
        doc.selection.deselect();
    } catch (ignoreDeselect) {}

    return true;
}

function ppsFindAlphaChannel(doc) {
    var channels = doc.channels;
    var fallback = null;
    var wanted = PPS.ALPHA_NAME.toLowerCase();

    for (var i = 0; i < channels.length; i++) {
        var n = "";
        try {
            n = String(channels[i].name);
        } catch (ignoreName) {
            continue;
        }
        if (!n) continue;
        var low = n.toLowerCase();
        if (low === wanted) return channels[i];
        if (!fallback && low.indexOf(wanted) === 0) fallback = channels[i];
    }
    return fallback;
}

function ppsFindTargetLayer(doc) {
    var layers = doc.layers;
    var i;
    for (i = layers.length - 1; i >= 0; i--) {
        try {
            if (layers[i].isBackgroundLayer) return layers[i];
        } catch (ignoreIsBg) {}
    }
    for (i = layers.length - 1; i >= 0; i--) {
        if (layers[i].typename === "ArtLayer") return layers[i];
    }
    return null;
}

function ppsRemoveLayersByName(doc, name) {
    for (var i = doc.layers.length - 1; i >= 0; i--) {
        var ly = doc.layers[i];
        if (ly.typename === "LayerSet") {
            ppsRemoveLayersInSet(ly, name);
        } else if (ly.name === name) {
            try {
                ly.remove();
            } catch (ignoreRemove) {}
        }
    }
}

function ppsRemoveLayersInSet(set, name) {
    for (var i = set.layers.length - 1; i >= 0; i--) {
        var ly = set.layers[i];
        if (ly.typename === "LayerSet") {
            ppsRemoveLayersInSet(ly, name);
        } else if (ly.name === name) {
            try {
                ly.remove();
            } catch (ignoreRemove2) {}
        }
    }
}

/* ---------------- 工具函数 ---------------- */

function ppsListFiles(folder, re) {
    var out = [];
    var all = folder.getFiles();
    for (var i = 0; i < all.length; i++) {
        var f = all[i];
        if (f instanceof File && re.test(f.name)) out.push(f);
    }
    out.sort(function (a, b) {
        var x = a.name.toLowerCase();
        var y = b.name.toLowerCase();
        return x < y ? -1 : (x > y ? 1 : 0);
    });
    return out;
}

function ppsListImages(folder) {
    var out = [];
    var exts = [/\.png$/i, /\.tif$/i, /\.tiff$/i, /\.jpe?g$/i];
    for (var e = 0; e < exts.length; e++) {
        var files = ppsListFiles(folder, exts[e]);
        for (var i = 0; i < files.length; i++) out.push(files[i]);
    }
    return out;
}

function ppsMakeMap(files) {
    var map = {};
    for (var i = 0; i < files.length; i++) {
        var k = ppsKey(files[i].name);
        if (!map[k]) map[k] = files[i];
    }
    return map;
}

function ppsKey(name) {
    var p = name.lastIndexOf(".");
    var base = p > 0 ? name.substring(0, p) : name;
    return base.toLowerCase();
}

function ppsSlash(p) {
    return String(p).replace(/\\/g, "/");
}

function ppsErr(e) {
    if (!e) return "未知错误";
    if (e.message) return e.message;
    return String(e);
}

function ppsJ(s) {
    if (s === null || s === undefined) return '""';
    s = String(s);
    var out = '"';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        var code = s.charCodeAt(i);
        if (c === '"') {
            out += '\\"';
        } else if (c === "\\") {
            out += "\\\\";
        } else if (code < 32) {
            out += " ";
        } else {
            out += c;
        }
    }
    return out + '"';
}
