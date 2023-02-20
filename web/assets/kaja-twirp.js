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

    let tabs = document.getElementsByClassName("tabnav-tabs");

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
    document.querySelectorAll('[data-autoresize]').forEach(function (element) {
      element.style.boxSizing = 'border-box';
      var offset = element.offsetHeight - element.clientHeight;
      element.addEventListener('input', function (event) {
        event.target.style.height = 'auto';
        event.target.style.height = event.target.scrollHeight + offset + 'px';
      });
      element.style.height = element.scrollHeight + offset + "px";
      element.removeAttribute('data-autoresize');
    });
  }

onDomLoaded(addAutoResize);