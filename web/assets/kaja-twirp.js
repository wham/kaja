function onDomLoaded(callback) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded");
    } else {
        callback();
    }
}

function updateTabs() {
    let hash = document.location.hash;
    let tab = document.getElementById(hash.substring(1));

    if (!tab) {
        return;
    }

    parent = tab.parentElement;

    for (let i = 0; i < parent.childElementCount; ++i) {
        let child = parent.children[i];
        child.style.display = "none";
    }

    tab.style.display = "";

    let tabs = document.getElementsByClassName("UnderlineNav-body");

    for (let i = 0; i < tabs.length; ++i) {
        let c = tabs[i];

        for (let j = 0; j < c.childElementCount; ++j) {
            let t = c.children[j];

            t.ariaCurrent = null;
            if (t.getAttribute("href") === hash) {
                t.ariaCurrent = "hello";
            }
        }
    }
}

onDomLoaded(updateTabs);
window.addEventListener("hashchange", updateTabs);

function addAutoResize() {
    document.querySelectorAll("[data-autoresize]").forEach(function(element) {
        element.style.boxSizing = "border-box";
        var offset = element.offsetHeight - element.clientHeight;
        element.addEventListener("input", function(event) {
            event.target.style.height = "auto";
            event.target.style.height = event.target.scrollHeight + offset + "px";
        });
        element.addEventListener("focus", function(event) {
            cover.style.display = "none";
            event.target.style.opacity = "";
            event.target.style.height = "auto";
            event.target.style.height = event.target.scrollHeight + offset + "px";
            event.target.style.position = "absolute";
            event.target.style.zIndex = "100";
        });
        element.addEventListener("blur", function(event) {
            event.target.style.height = "39px"; 
            event.target.style.position = "static";  
            event.target.style.zIndex = "auto";            
            event.target.style.opacity = "0";
            cover.style.display = "";
            cover.innerText = event.target.value.replace(/\n/g, " ");
        });
        element.style.height = "39px";
        element.removeAttribute("data-autoresize");

        var cover = document.createElement("div");
        cover.style.position = "absolute";
        cover.style.zIndex = "10";
        cover.style.top = "0";
        cover.style.left = "0";
        cover.style.height = "39px";
        cover.style.width = "100%";
        cover.style.cursor = "text";
        cover.className = "border rounded-2";
        cover.style.padding = "8px 12px";
        cover.style.overflow = "hidden";
        cover.style.whiteSpace = "nowrap";
        cover.style.textOverflow = "ellipsis";
        cover.innerText = element.value.replace(/\n/g, " ");
        element.parentElement.appendChild(cover);
        element.style.opacity = "0";

        cover.addEventListener("click", function(event) {
            let offset = getCaretOffset(event);
            element.focus();
            element.selectionStart = offset;
            element.selectionEnd = offset;
        });
    });
}

function getCaretOffset(e) {
    let range;
    let offset = 0;
    
    if (document.caretPositionFromPoint) {    // standard
        range = document.caretPositionFromPoint(e.pageX, e.pageY);
        offset = range.offset;
    
    } else if (document.caretRangeFromPoint) {    // WebKit
        range = document.caretRangeFromPoint(e.pageX, e.pageY);
        offset = range.startOffset;
    }

    return offset;
}

onDomLoaded(addAutoResize);