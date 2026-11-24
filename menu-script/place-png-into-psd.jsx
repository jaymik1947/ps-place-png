/*
 * ============================================================
 *  批量置入 PNG 到同名 PSD   ·   Photoshop ExtendScript
 * ============================================================
 *
 *  目录结构（选中的父目录下必须有这三个子文件夹）：
 *
 *    父目录/
 *      |- mat_2/    <名称>.png    材质层
 *      |- obj_1/    <名称>.png    物体层
 *      |- rgba/     <名称>.psd    目标文件
 *
 *  配对规则：三个文件夹里“文件名去掉扩展名后相同”的自动配成一组。
 *
 *  图层规则：mat 在下、obj 在上，做成普通像素图层（非智能对象），图层名
 *            就叫 mat / obj；随后两者一起收进名为 aov 的图层组，该组默认
 *            隐藏，所以打开 PSD 只看到背景层，需要时点开 aov 组即可。
 *
 *  保存方式：直接覆盖原 PSD。
 *  重复运行安全：每次先删掉文档里已有的 mat / obj 图层，再加新的。
 *                （不需要这个行为就把 REMOVE_EXISTING 设为 false）
 *
 *  Alpha 通道处理（APPLY_ALPHA = true 时生效）：
 *    打开 PSD 后、置入 PNG 之前，检查该 PSD 的通道面板，
 *    若有名为 Alpha（或 Alpha 1 这类默认名）的通道，就把它载入为选区
 *    并应用到背景图层上（生成图层蒙版），让 alpha 真正生效；
 *    若该 PSD 没有 Alpha 通道，原样跳过，不做任何改动。
 *
 *  用法：Photoshop 菜单 -> 文件 -> 脚本 -> 浏览... -> 选中本文件
 *
 *  需要改目录名或图层名，只改下面 CONFIG 里的值即可。
 * ============================================================
 */

#target photoshop

var CONFIG = {
    MAT_DIR: "mat_2",
    OBJ_DIR: "obj_1",
    PSD_DIR: "rgba",
    MAT_LAYER: "mat",
    OBJ_LAYER: "obj",
    AOV_GROUP: "aov",
    REMOVE_EXISTING: true,
    CLEAN_OTHER_LAYERS: true,
    SAVE: true,
    CLOSE_AFTER_SAVE: true,
    TEST_FIRST_ONLY: false,
    APPLY_ALPHA: true,
    ALPHA_CHANNEL_NAME: "Alpha",
    ALPHA_MODE: "mask",
    ALPHA_INVERT: false
};

main();

function main() {
    var startTime = new Date().getTime();

    var parent = Folder.selectDialog("请选择父文件夹（内部含 " + CONFIG.MAT_DIR + " / " + CONFIG.OBJ_DIR + " / " + CONFIG.PSD_DIR + " 三个子文件夹）");
    if (!parent) {
        return;
    }

    var matDir = new Folder(parent.fsName + "/" + CONFIG.MAT_DIR);
    var objDir = new Folder(parent.fsName + "/" + CONFIG.OBJ_DIR);
    var psdDir = new Folder(parent.fsName + "/" + CONFIG.PSD_DIR);

    var missing = [];
    if (!matDir.exists) missing.push(CONFIG.MAT_DIR);
    if (!objDir.exists) missing.push(CONFIG.OBJ_DIR);
    if (!psdDir.exists) missing.push(CONFIG.PSD_DIR);
    if (missing.length > 0) {
        alert("父目录下找不到这些子文件夹：\n\n  " + missing.join("\n  ") +
              "\n\n父目录：" + parent.fsName +
              "\n\n请确认选的是包含 " + CONFIG.MAT_DIR + " / " + CONFIG.OBJ_DIR + " / " + CONFIG.PSD_DIR + " 的那一层目录。");
        return;
    }

    var matMap = buildMap(matDir);
    var objMap = buildMap(objDir);
    var psdFiles = listFiles(psdDir, /\.psd$/i);

    if (psdFiles.length === 0) {
        alert(CONFIG.PSD_DIR + " 文件夹里没有 .psd 文件。\n\n" + psdDir.fsName);
        return;
    }

    var matCount = countKeys(matMap);
    var objCount = countKeys(objMap);
    if (matCount === 0 && objCount === 0) {
        alert(CONFIG.MAT_DIR + " 和 " + CONFIG.OBJ_DIR + " 文件夹里都没找到图片文件（png / tif / jpg）。\n\n" +
              matDir.fsName + "\n" + objDir.fsName);
        return;
    }

    var pairable = 0;
    var preview = [];
    for (var p = 0; p < psdFiles.length; p++) {
        var pk = stripExt(psdFiles[p].name).toLowerCase();
        if (matMap[pk] || objMap[pk]) {
            pairable++;
            if (preview.length < 5) preview.push(psdFiles[p].name);
        }
    }

    var msg = "扫描结果\n";
    msg += "----------------------------\n";
    msg += "PSD 文件：" + psdFiles.length + " 个\n";
    msg += CONFIG.MAT_DIR + " 图片：" + matCount + " 个\n";
    msg += CONFIG.OBJ_DIR + " 图片：" + objCount + " 个\n";
    msg += "可配对处理：" + pairable + " 个\n";
    if (preview.length > 0) {
        msg += "\n例如：\n  " + preview.join("\n  ");
        if (pairable > preview.length) msg += "\n  ...";
    }
    msg += "\n\n处理方式：把 PNG 作为普通像素图层置入对应 PSD\n";
    if (CONFIG.APPLY_ALPHA) {
        msg += "置入前若该 PSD 带名为 " + CONFIG.ALPHA_CHANNEL_NAME + " 的通道，先把它应用到背景图层；没有则跳过。\n";
    }
    if (CONFIG.CLEAN_OTHER_LAYERS) {
        msg += "背景层和 " + CONFIG.AOV_GROUP + " 组以外的其他图层会被删除。\n";
    }
    msg += "（" + CONFIG.MAT_LAYER + " 在下、" + CONFIG.OBJ_LAYER + " 在上），";
    msg += CONFIG.SAVE ? "然后【覆盖保存】原 PSD。" : "不保存。";
    msg += "\n\n重复运行会先删除已有的 " + CONFIG.MAT_LAYER + " / " + CONFIG.OBJ_LAYER + " 图层。";
    msg += "\n\n现在开始？";

    if (!confirm(msg)) {
        return;
    }

    var report = {
        ok: [],
        fail: [],
        onlyMat: [],
        onlyObj: [],
        noPair: [],
        sizeWarn: [],
        layerFail: [],
        alreadyOpen: [],
        alphaApplied: [],
        alphaFail: [],
        cleaned: 0
    };
    var usedMat = {};
    var usedObj = {};

    var oldDialogs = app.displayDialogs;
    var oldUnits = app.preferences.rulerUnits;
    var oldCompat = null;
    try {
        oldCompat = app.preferences.maximizeCompatibility;
        if (typeof oldCompat === "undefined") oldCompat = null;
    } catch (ignoreCompat) {
        oldCompat = null;
    }

    app.displayDialogs = DialogModes.NO;
    app.preferences.rulerUnits = Units.PIXELS;
    if (oldCompat !== null) {
        try {
            app.preferences.maximizeCompatibility = QueryStateType.ALWAYS;
        } catch (ignoreCompat2) {}
    }

    var total = CONFIG.TEST_FIRST_ONLY ? Math.min(1, pairable) : psdFiles.length;
    var done = 0;

    try {
        for (var i = 0; i < psdFiles.length; i++) {
            if (done >= total) break;

            var psdFile = psdFiles[i];
            var key = stripExt(psdFile.name).toLowerCase();
            var matFile = matMap[key] || null;
            var objFile = objMap[key] || null;

            if (!matFile && !objFile) {
                report.noPair.push(psdFile.name);
                continue;
            }

            // 已经开在 Photoshop 里的文档不碰，避免脚本把你正在编辑的文件关掉
            if (findOpenDocument(psdFile)) {
                report.alreadyOpen.push(psdFile.name);
                continue;
            }

            if (!matFile) report.onlyObj.push(psdFile.name + "  （缺 " + CONFIG.MAT_DIR + "）");
            if (!objFile) report.onlyMat.push(psdFile.name + "  （缺 " + CONFIG.OBJ_DIR + "）");

            if (matFile) usedMat[key] = true;
            if (objFile) usedObj[key] = true;

            try {
                processPsd(psdFile, matFile, objFile, report);
                report.ok.push(psdFile.name);
            } catch (err) {
                report.fail.push(psdFile.name + "  →  " + errMsg(err));
            }
            done++;
        }
    } finally {
        app.displayDialogs = oldDialogs;
        try {
            app.preferences.rulerUnits = oldUnits;
        } catch (ignoreUnits) {}
        if (oldCompat !== null) {
            try {
                app.preferences.maximizeCompatibility = oldCompat;
            } catch (ignoreCompat3) {}
        }
    }

    var unusedMat = [];
    var unusedObj = [];
    for (var mk in matMap) {
        if (!usedMat[mk]) unusedMat.push(matMap[mk].name);
    }
    for (var ok2 in objMap) {
        if (!usedObj[ok2]) unusedObj.push(objMap[ok2].name);
    }

    var secs = Math.round((new Date().getTime() - startTime) / 1000);
    var summary = buildSummary(secs, psdFiles.length, pairable, report, unusedMat, unusedObj);

    try {
        app.bringToFront();
    } catch (ignoreFront) {}
    alert(summary);
}

function processPsd(psdFile, matFile, objFile, report) {
    var doc = app.open(psdFile);
    if (!doc) {
        throw new Error("Photoshop 无法打开该 PSD");
    }

    try {
        app.activeDocument = doc;
        // 上一个文件可能残留选区，先清干净
        try {
            doc.selection.deselect();
        } catch (ignoreResidualSelection) {}

        if (CONFIG.REMOVE_EXISTING) {
            // 先整组删掉上一轮的 aov（连带里面的旧图层），再扫散落在别处的同名图层
            removeGroupsByName(doc, CONFIG.AOV_GROUP);
            removeLayersByName(doc, CONFIG.MAT_LAYER);
            removeLayersByName(doc, CONFIG.OBJ_LAYER);
        }

        // 可选：把背景层以外的其他图层全清掉。
        // 应对旧图层被改过名（如 yjq_032000x2000）导致按名删除失效的情况。
        if (CONFIG.CLEAN_OTHER_LAYERS) {
            var nCleaned = cleanOtherLayers(doc);
            if (nCleaned > 0) {
                report.cleaned += nCleaned;
            }
        }

        // 置入之前，先把 PSD 里的 Alpha 通道应用到背景图层。
        // 没有该通道就跳过；应用失败也不阻断置入，只记进报告。
        if (CONFIG.APPLY_ALPHA) {
            try {
                applyAlphaToPsd(doc, report, psdFile.name);
            } catch (eAlpha) {
                report.alphaFail.push(psdFile.name + "  →  【应用 Alpha】" + errMsg(eAlpha));
                try {
                    doc.selection.deselect();
                } catch (ignoreAlphaCleanup) {}
                try {
                    app.activeDocument = doc;
                } catch (ignoreAlphaReactive) {}
            }
        }

        var expect = 0;
        var placed = 0;
        var matLayer = null;
        var objLayer = null;

        if (matFile) {
            expect++;
            matLayer = placeAsLayer(doc, matFile, CONFIG.MAT_LAYER, report);
            if (matLayer) placed++;
        }
        if (objFile) {
            expect++;
            objLayer = placeAsLayer(doc, objFile, CONFIG.OBJ_LAYER, report);
            if (objLayer) placed++;
        }

        // 有任何一个图层没置入成功，就整体放弃保存，保证原 PSD 不被改成半成品
        if (placed < expect) {
            throw new Error("有图层置入失败，已放弃保存（原 PSD 未被改动）");
        }

        // 收进 aov 组并隐藏，画面上只留背景层
        groupIntoAov(doc, matLayer, objLayer);

        if (CONFIG.SAVE) {
            app.activeDocument = doc;
            doc.save();
        }
    } finally {
        if (CONFIG.SAVE && CONFIG.CLOSE_AFTER_SAVE) {
            try {
                doc.close(SaveOptions.DONOTSAVECHANGES);
            } catch (ignoreClose) {}
        }
    }
}

/**
 * 把 mat / obj 收进名为 aov 的组，并隐藏该组。
 * 结果：图层面板顶层只有一个隐藏的 aov 组，画面上只显示背景层。
 */
function groupIntoAov(doc, matLayer, objLayer) {
    if (!matLayer && !objLayer) return;

    removeGroupsByName(doc, CONFIG.AOV_GROUP);

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
        group.name = CONFIG.AOV_GROUP;
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

function removeGroupsByName(doc, name) {
    var targets = [];
    collectLayersByName(doc, name, true, targets);
    for (var i = targets.length - 1; i >= 0; i--) {
        unlockAndRemove(targets[i]);
    }
    return targets.length;
}

function placeAsLayer(destDoc, imgFile, layerName, report) {
    var srcDoc = null;
    try {
        srcDoc = app.open(imgFile);
        if (!srcDoc) {
            throw new Error("无法打开 " + imgFile.name);
        }

        // 位深 / 色彩模式不一致时 duplicate 必然失败，提前给出明确原因
        var modeOk = true;
        var bitsOk = true;
        var modeMsg = "";
        var bitsMsg = "";
        try {
            modeOk = String(srcDoc.mode) === String(destDoc.mode);
            bitsOk = String(srcDoc.bitsPerChannel) === String(destDoc.bitsPerChannel);
            modeMsg = String(srcDoc.mode) + " → " + String(destDoc.mode);
            bitsMsg = String(srcDoc.bitsPerChannel) + " → " + String(destDoc.bitsPerChannel);
        } catch (ignoreMeta) {}
        if (!modeOk) {
            throw new Error("色彩模式不一致（PNG → PSD）：" + modeMsg);
        }
        if (!bitsOk) {
            throw new Error("位深不一致（PNG → PSD）：" + bitsMsg);
        }

        var sw = srcDoc.width.as("px");
        var sh = srcDoc.height.as("px");
        var dw = destDoc.width.as("px");
        var dh = destDoc.height.as("px");

        if (Math.abs(sw - dw) > 0.5 || Math.abs(sh - dh) > 0.5) {
            report.sizeWarn.push(
                imgFile.name + "  " + Math.round(sw) + "×" + Math.round(sh) +
                "  →  PSD " + Math.round(dw) + "×" + Math.round(dh)
            );
        }

        // 跨文档搬运：源文档必须是前台文档。
        // 先走图层复制，失败再回退到剪贴板粘贴。
        var newLayer = null;
        var firstError = null;

        try {
            newLayer = copyLayerByDuplicate(srcDoc, destDoc);
        } catch (e1) {
            firstError = e1;
        }
        if (!newLayer) {
            try {
                newLayer = copyLayerByPaste(srcDoc, destDoc);
            } catch (e2) {
                throw new Error("复制失败：" + errMsg(e2) +
                    (firstError ? "（图层复制也失败：" + errMsg(firstError) + "）" : ""));
            }
        }
        if (!newLayer) {
            throw new Error("复制失败：没有拿到新图层");
        }

        newLayer.name = layerName;

        // 对齐到画布左上角原点，保证与原 PSD 画布严丝合缝。
        // 对齐失败只影响位置，不算置入失败。
        try {
            var b = newLayer.bounds;
            var left = b[0].as("px");
            var top = b[1].as("px");
            if (Math.abs(left) > 0.01 || Math.abs(top) > 0.01) {
                newLayer.translate(-left, -top);
            }
        } catch (ignoreBounds) {}

        return newLayer;
    } catch (e) {
        report.layerFail.push(imgFile.name + "  →  " + errMsg(e));
        return null;
    } finally {
        if (srcDoc) {
            try {
                srcDoc.close(SaveOptions.DONOTSAVECHANGES);
            } catch (ignoreClose2) {}
        }
    }
}

function copyLayerByDuplicate(srcDoc, destDoc) {
    app.activeDocument = srcDoc;
    var srcLayer = srcDoc.activeLayer;
    if (!srcLayer) return null;

    // 不要传第二个参数 insertionLocation。
    // 一旦传了，Photoshop 会额外校验“目标文档必须是最前面的文档”而报错；
    // 省略时图层自动落在目标文档图层堆栈顶部，正是我们要的。
    var newLayer = srcLayer.duplicate(destDoc);

    app.activeDocument = destDoc;
    if (!newLayer) {
        newLayer = destDoc.activeLayer;
    }
    return newLayer;
}

function copyLayerByPaste(srcDoc, destDoc) {
    app.activeDocument = srcDoc;
    srcDoc.selection.selectAll();
    srcDoc.selection.copy();

    app.activeDocument = destDoc;
    try {
        destDoc.selection.deselect();
    } catch (ignoreDesel) {}
    destDoc.paste();

    return destDoc.activeLayer;
}

/**
 * 在文档里找 Alpha 通道：
 * 优先精确匹配 CONFIG.ALPHA_CHANNEL_NAME（默认 "Alpha"），
 * 其次匹配 "Alpha 1" / "Alpha1" 这类 PS 默认命名。找不到返回 null。
 */
function findAlphaChannel(doc) {
    var channels = doc.channels;
    var fallback = null;
    var wanted = CONFIG.ALPHA_CHANNEL_NAME.toLowerCase();

    for (var i = 0; i < channels.length; i++) {
        var n = "";
        try {
            n = String(channels[i].name);
        } catch (ignoreName) {
            continue;
        }
        if (!n) continue;

        var low = n.toLowerCase();
        if (low === wanted) {
            return channels[i];
        }
        if (!fallback && low.indexOf(wanted) === 0) {
            fallback = channels[i];
        }
    }
    return fallback;
}

/**
 * 找 Alpha 要作用的图层：优先背景层，没有背景层就取最下面的普通图层。
 * 图层组不能挂蒙版，跳过。
 */
function findTargetLayer(doc) {
    var layers = doc.layers;
    var i;

    for (i = layers.length - 1; i >= 0; i--) {
        try {
            if (layers[i].isBackgroundLayer) {
                return layers[i];
            }
        } catch (ignoreIsBg) {}
    }
    for (i = layers.length - 1; i >= 0; i--) {
        if (layers[i].typename === "ArtLayer") {
            return layers[i];
        }
    }
    return null;
}

/**
 * 用当前选区生成图层蒙版。
 * revealOrHide：RvlS = 选区内显示，HdSl = 选区内隐藏。
 */
function createMaskFromSelection(revealOrHide) {
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(charIDToTypeID("Chnl"));
    desc.putClass(charIDToTypeID("Nw  "), charIDToTypeID("Chnl"));
    desc.putReference(charIDToTypeID("At  "), ref);
    desc.putEnumerated(charIDToTypeID("Usng"), charIDToTypeID("UsrM"), charIDToTypeID(revealOrHide));
    executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
}

/**
 * 把 PSD 里的 Alpha 通道应用到背景图层：载入通道为选区，再生成图层蒙版
 * （选区内显示、选区外隐藏）。背景层锁定，先转成普通图层。
 * 返回 true = 已处理；false = 没有 Alpha 通道或通道为空，跳过。
 */
function applyAlphaToPsd(doc, report, fileName) {
    var channel = findAlphaChannel(doc);
    if (!channel) {
        return false;
    }

    app.activeDocument = doc;

    var layer = findTargetLayer(doc);
    if (!layer) {
        throw new Error("找不到可接受 Alpha 的图层");
    }

    // 目标图层必须是活动图层，蒙版才会挂在它上面
    try {
        doc.activeLayer = layer;
    } catch (ignoreActive) {}

    // 背景层锁定且不支持透明，先转成普通图层
    try {
        if (layer.isBackgroundLayer) {
            layer.isBackgroundLayer = false;
        }
    } catch (ignoreBg) {}

    // 把通道载入为选区
    doc.selection.load(channel, SelectionType.REPLACE);

    // 确认选区真的有内容。取不到边界时按"有"处理，交给后面去试，
    // 绝不在这里静默放弃——否则会出现"只解锁了背景层、什么都没做"的结果。
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
        throw new Error("Alpha 通道载入后选区为空，通道可能是全黑");
    }

    if (CONFIG.ALPHA_MODE === "delete") {
        // 默认抠掉选区外的像素（ALPHA_INVERT 时抠选区内的）
        if (!CONFIG.ALPHA_INVERT) {
            doc.selection.invert();
        }
        doc.selection.clear();
    } else {
        // 默认生成图层蒙版。万一这台 PS 不认这套动作，退到直接抠除，
        // 保证一定有可见效果，而不是什么都没发生。
        try {
            createMaskFromSelection(CONFIG.ALPHA_INVERT ? "HdSl" : "RvlS");
        } catch (eMask) {
            doc.selection.load(channel, SelectionType.REPLACE);
            if (!CONFIG.ALPHA_INVERT) {
                doc.selection.invert();
            }
            doc.selection.clear();
        }
    }

    try {
        doc.selection.deselect();
    } catch (ignoreDeselect) {}

    report.alphaApplied.push(fileName + "  [匹配通道：" + channel.name + "]");
    return true;
}

function findOpenDocument(file) {
    var target = file.fsName.toLowerCase();
    for (var i = 0; i < app.documents.length; i++) {
        try {
            var d = app.documents[i];
            if (d.fullName && d.fullName.fsName.toLowerCase() === target) {
                return d;
            }
        } catch (ignoreFullName) {}
    }
    return null;
}

/*
 * 图层 / 组清理
 * ---------------
 * 旧实现边遍历 doc.layers 边删除，而 doc.layers 是活集合，删完索引就漂移，
 * 导致旧图层漏删（表现为 aov 组外还留着上一轮的 mat / obj）。
 * 这里改成：先拍快照收集目标，再统一删除。
 */

function layerNameMatch(actual, wanted) {
    if (actual === null || actual === undefined) return false;
    var a = String(actual).replace(/^\s+|\s+$/g, "").toLowerCase();
    var w = String(wanted).replace(/^\s+|\s+$/g, "").toLowerCase();
    if (!a || !w) return false;
    if (a === w) return true;
    // Photoshop 会给重名图层自动加 “ 副本” / “ copy” 后缀
    if (a.indexOf(w + " ") === 0) return true;
    if (a.indexOf(w + "副本") === 0) return true;
    return false;
}

function collectLayersByName(container, name, wantGroups, out) {
    var list = null;
    try {
        list = container.layers;
    } catch (eLayers) {
        return;
    }
    if (!list) return;

    var snapshot = [];
    var total = 0;
    try {
        total = list.length;
    } catch (eLen) {
        return;
    }
    for (var i = 0; i < total; i++) {
        try {
            snapshot.push(list[i]);
        } catch (eItem) {}
    }

    for (var k = 0; k < snapshot.length; k++) {
        var ly = snapshot[k];
        var isGroup = false;
        try {
            isGroup = ly.typename === "LayerSet";
        } catch (eType) {}

        if (isGroup) {
            if (wantGroups) {
                if (layerNameMatch(ly.name, name)) {
                    out.push(ly);
                } else {
                    collectLayersByName(ly, name, true, out);
                }
            } else {
                collectLayersByName(ly, name, false, out);
            }
        } else if (!wantGroups && layerNameMatch(ly.name, name)) {
            out.push(ly);
        }
    }
}

function unlockAndRemove(item) {
    try {
        if (item.allLocked) item.allLocked = false;
    } catch (eLock) {}
    try {
        item.remove();
        return true;
    } catch (eRemove) {
        return false;
    }
}

function removeLayersByName(doc, name) {
    var targets = [];
    collectLayersByName(doc, name, false, targets);
    var removed = 0;
    for (var i = targets.length - 1; i >= 0; i--) {
        if (unlockAndRemove(targets[i])) removed++;
    }
    return removed;
}

/**
 * 删掉除背景层和 aov 组以外的所有顶层图层。
 * 用于旧图层被改过名（如 yjq_032000x2000）的情况——按名删找不到它们，
 * 但它们在合成结果里就是多余的重复内容。
 * 返回删除数量。
 */
function cleanOtherLayers(doc) {
    var snapshot = [];
    var total = 0;
    try {
        total = doc.layers.length;
    } catch (eLen) {
        return 0;
    }
    if (total === 0) return 0;
    for (var i = 0; i < total; i++) {
        try {
            snapshot.push(doc.layers[i]);
        } catch (eItem) {}
    }
    if (!snapshot.length) return 0;

    // 最底层无论如何都保留——它就是背景。
    // 背景层一旦被 Alpha 处理解锁，isBackgroundLayer 就变成 false，
    // 只看这个属性会把背景层一起删掉，然后 mat 顶上来冒充背景。
    var lowestIndex = snapshot.length - 1;

    var targets = [];
    for (var k = 0; k < snapshot.length; k++) {
        if (k === lowestIndex) continue;

        var ly = snapshot[k];

        var isBg = false;
        try {
            isBg = ly.isBackgroundLayer === true;
        } catch (eBg) {}
        if (!isBg) {
            try {
                isBg = layerNameMatch(ly.name, "背景") || layerNameMatch(ly.name, "background");
            } catch (eNameBg) {}
        }
        if (isBg) continue;

        var isAov = false;
        try {
            isAov = (ly.typename === "LayerSet") && layerNameMatch(ly.name, CONFIG.AOV_GROUP);
        } catch (eAov) {}
        if (isAov) continue;

        targets.push(ly);
    }

    // 保险：如果算出「所有图层都该删」，说明判据失效，宁可不清理
    if (targets.length >= snapshot.length) {
        return 0;
    }

    var removed = 0;
    for (var j = targets.length - 1; j >= 0; j--) {
        if (unlockAndRemove(targets[j])) removed++;
    }
    return removed;
}

function buildMap(folder) {
    var map = {};
    var exts = [/\.png$/i, /\.tif$/i, /\.tiff$/i, /\.jpe?g$/i];
    for (var e = 0; e < exts.length; e++) {
        var files = listFiles(folder, exts[e]);
        for (var i = 0; i < files.length; i++) {
            var key = stripExt(files[i].name).toLowerCase();
            if (!map[key]) {
                map[key] = files[i];
            }
        }
    }
    return map;
}

function listFiles(folder, re) {
    var out = [];
    var all = folder.getFiles();
    for (var i = 0; i < all.length; i++) {
        var f = all[i];
        if (f instanceof File && re.test(f.name)) {
            out.push(f);
        }
    }
    out.sort(function (a, b) {
        var x = a.name.toLowerCase();
        var y = b.name.toLowerCase();
        return x < y ? -1 : (x > y ? 1 : 0);
    });
    return out;
}

function stripExt(n) {
    var p = n.lastIndexOf(".");
    return p > 0 ? n.substring(0, p) : n;
}

function countKeys(obj) {
    var c = 0;
    for (var k in obj) {
        c++;
    }
    return c;
}

function errMsg(e) {
    if (!e) return "未知错误";
    if (e.message) return e.message;
    return String(e);
}

function buildSummary(secs, totalPsd, pairable, report, unusedMat, unusedObj) {
    var s = "";
    s += "批量置入完成（用时 " + secs + " 秒）\n";
    s += "================================\n";
    s += "PSD 总数：" + totalPsd + "  可配对：" + pairable + "\n";
    s += "成功：" + report.ok.length + "    失败：" + report.fail.length + "\n";
    s += "图层：" + CONFIG.MAT_LAYER + " 在下、" + CONFIG.OBJ_LAYER + " 在上（普通像素图层）\n";
    if (report.cleaned > 0) {
        s += "已清理多余图层：" + report.cleaned + " 个\n";
    }
    if (CONFIG.APPLY_ALPHA) {
        s += "Alpha 通道：" + report.alphaApplied.length + " 个 PSD 已应用\n";
    }

    if (report.fail.length > 0) {
        s += "\n[失败] " + report.fail.length + " 个\n";
        s += "  " + joinLimited(report.fail, 8) + "\n";
    }
    if (report.layerFail.length > 0) {
        s += "\n[图层置入失败明细] " + report.layerFail.length + " 条\n";
        s += "  " + joinLimited(report.layerFail, 6) + "\n";
    }
    if (report.alphaFail.length > 0) {
        s += "\n[Alpha 应用失败，已跳过，未影响置入] " + report.alphaFail.length + " 条\n";
        s += "  " + joinLimited(report.alphaFail, 6) + "\n";
    }
    if (report.sizeWarn.length > 0) {
        s += "\n[尺寸不一致] " + report.sizeWarn.length + " 个（已按左上角对齐置入）\n";
        s += "  " + joinLimited(report.sizeWarn, 6) + "\n";
    }
    if (report.onlyMat.length > 0) {
        s += "\n[只有 " + CONFIG.MAT_DIR + "] " + report.onlyMat.length + " 个\n";
        s += "  " + joinLimited(report.onlyMat, 6) + "\n";
    }
    if (report.onlyObj.length > 0) {
        s += "\n[只有 " + CONFIG.OBJ_DIR + "] " + report.onlyObj.length + " 个\n";
        s += "  " + joinLimited(report.onlyObj, 6) + "\n";
    }
    if (report.noPair.length > 0) {
        s += "\n[没找到同名 PNG，已跳过] " + report.noPair.length + " 个\n";
        s += "  " + joinLimited(report.noPair, 6) + "\n";
    }
    if (report.alreadyOpen.length > 0) {
        s += "\n[已在 Photoshop 中打开，已跳过] " + report.alreadyOpen.length + " 个\n";
        s += "  这些文档先关掉再重新运行脚本：\n";
        s += "  " + joinLimited(report.alreadyOpen, 6) + "\n";
    }
    if (unusedMat.length > 0 || unusedObj.length > 0) {
        s += "\n[多余的 PNG（没有对应 PSD）]\n";
        if (unusedMat.length > 0) s += "  " + CONFIG.MAT_DIR + "： " + joinLimited(unusedMat, 6) + "\n";
        if (unusedObj.length > 0) s += "  " + CONFIG.OBJ_DIR + "： " + joinLimited(unusedObj, 6) + "\n";
    }

    return s;
}

function joinLimited(arr, max) {
    var out = [];
    for (var i = 0; i < arr.length && i < max; i++) {
        out.push(arr[i]);
    }
    var text = out.join("\n  ");
    if (arr.length > max) {
        text += "\n  ... 另有 " + (arr.length - max) + " 条";
    }
    return text;
}
