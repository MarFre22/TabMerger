/* 
TabMerger as the name implies merges your tabs into one location to save
memory usage and increase your productivity.

Copyright (C) 2021  Lior Bragilevsky

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

If you have any questions, comments, or concerns you can contact the
TabMerger team at <https://tabmerger.herokuapp.com/contact/>
*/

/**
 * extension click from toolbar - open TabMerger with or without merging tabs (according to settings)
 */
const handleBrowserIconClick = () => {
  chrome.storage.sync.get("settings", async (result) => {
    result.settings === undefined || result.settings.open === "without"
      ? await findExtTabAndSwitch()
      : await filterTabs(info, tab);
  });
};

/**
 * Filters a list of tabs according to the merging information provided in the parameters.
 * Sets the local storage item corresponding to the group to merge into and the tabs to merge.
 * Avoids duplicates as much as possible. If duplicate tabs are merged, only a single copy of the
 * many duplicates is included in the merge (the other duplicate tabs are simply closed).
 * @param {{which: string}} info which direction to merge from
 * @param {{title: string, url: string, id?: string}} tab indicates where the merging call originated from
 * @param {string?} group_id the group to merge into (if merge button from one of TabMerger's groups is used)
 */
async function filterTabs(info, tab, group_id) {
  // navigate to TabMerger before proceeding
  await findExtTabAndSwitch();

  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    // filter based on user's merge button click
    tabs = tabs.filter((x) => x.title !== "TabMerger");
    switch (info.which) {
      case "right":
        tabs = tabs.filter((x) => x.index > tab.index);
        break;
      case "left":
        tabs = tabs.filter((x) => x.index < tab.index);
        break;
      case "excluding":
        tabs = tabs.filter((x) => x.index !== tab.index);
        break;
      case "only":
        tabs = tabs.filter((x) => x.index === tab.index);
        break;

      default:
        //all (already filtered all tabs except TabMerger)
        break;
    }

    // create duplicate title/url list & filter blacklisted sites
    var filter_vals = ["TabMerger", "New Tab", "Extensions", "Add-ons Manager"];

    chrome.storage.sync.get("settings", (sync) => {
      chrome.storage.local.get("groups", (local) => {
        // get a list of all the current tab titles and/or urls
        var group_blocks = local.groups;
        Object.keys(group_blocks).forEach((key) => {
          var extra_vals = group_blocks[key].tabs.map((x) => x.url);
          filter_vals = filter_vals.concat(extra_vals);
        });

        // apply blacklist items
        tabs = tabs.filter((x) => {
          var bl_sites = sync.settings.blacklist.replace(" ", "").split(",");
          bl_sites = bl_sites.map((site) => site.toLowerCase());
          return !bl_sites.includes(x.url);
        });

        // remove unnecessary information from each tab
        tabs = tabs.map((x) => {
          return {
            title: x.title,
            url: x.url,
            id: x.id,
          };
        });

        // duplicates (already in TabMerger) can be removed
        var duplicates = tabs.filter((x) => {
          return filter_vals.includes(x.title) || filter_vals.includes(x.url);
        });

        chrome.tabs.remove(duplicates.map((x) => x.id));

        // apply above filter
        tabs = tabs.filter((x) => {
          return !filter_vals.includes(x.title) && !filter_vals.includes(x.url);
        });

        // make sure original merge has no duplicated values obtain offending indicies
        // prettier-ignore
        var prev_urls = [], indicies = [];
        tabs.forEach((x, i) => {
          if (prev_urls.includes(x.url)) {
            indicies.push(i);
          } else {
            prev_urls.push(x.url);
          }
        });

        // close duplicates in the merging process
        indicies.forEach((i) => {
          chrome.tabs.remove(tabs[i].id);
        });

        // filter out offending indicies
        tabs = tabs.filter((_, i) => !indicies.includes(i));

        var whichGroup = group_id ? group_id : "group-0";
        chrome.storage.local.set({
          into_group: whichGroup,
          merged_tabs: tabs,
        });
      });
    });
  });
}

/**
 * When TabMerger is open, this navigates to its tab if not on that tab already.
 * When TabMerger is not open, this opens its tab on the very right side.
 * Function ends when TabMerger's tab becomes active and its loading status is complete.
 *
 * @return A promise which should be awaited. Resolve value is insignificant
 */
function findExtTabAndSwitch() {
  var query = { title: "TabMerger", currentWindow: true };
  var exists = { highlighted: true, active: true };
  var not_exist = { url: "index.html", active: true };
  return new Promise((resolve) => {
    chrome.tabs.query(query, (tabMergerTabs) => {
      tabMergerTabs[0]
        ? chrome.tabs.update(tabMergerTabs[0].id, exists, () => {
            resolve(0);
          })
        : chrome.tabs.create(not_exist, (newTab) => {
            function listener(tabId, changeInfo) {
              if (changeInfo.status === "complete" && tabId === newTab.id) {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(0);
              }
            }
            chrome.tabs.onUpdated.addListener(listener);
          });
    });
  });
}

/**
 * Fired when an extension merge button is clicked.
 * Filters the tabs in the current window to prepare for the merging process.
 * @param {{msg: string, id: string}} request Contains information regarding
 * which way to merge and the calling tab's id
 */
const extensionMessage = (request) => {
  info.which = request.msg;
  var queryOpts = { currentWindow: true, active: true };
  chrome.tabs.query(queryOpts, async (tabs) => {
    await filterTabs(info, tabs[0], request.id);
  });
};

/**
 * Helper function for creating a contextMenu (right click) item.
 * @param {string} id unique value for locating each contextMenu item added
 * @param {string} title the contextMenu's item title
 * @param {string} type "separator" or "normal" (default)
 */
function createContextMenu(id, title, type) {
  chrome.contextMenus.create({ id, title, type });
}

/**
 * Handles contextMenu item clicks or keyboard shortcut events for both merging actions and
 * other actions like excluding from visibility, opening TabMerger, visiting help site, etc.
 * @param {{which: string, command?: string, menuItemId?: string}} info Indicates merging direction,
 * keyboard command, and/or the contextMenu item that was clicked
 * @param {{url: string, title: string, id?: string}} tab The tab for which the event occured.
 * Used when determining which tabs to merge
 */
const contextMenuOrShortCut = async (info, tab) => {
  // need to alter the info object if it comes from a keyboard shortcut event
  if (typeof info === "string") {
    info = { which: "all", command: info };
  }

  switch (info.menuItemId || info.command) {
    case "aopen-tabmerger":
      await findExtTabAndSwitch();
      break;
    case "merge-left-menu":
      info.which = "left";
      await filterTabs(info, tab);
      break;
    case "merge-right-menu":
      info.which = "right";
      await filterTabs(info, tab);
      break;
    case "merge-xcluding-menu":
      info.which = "excluding";
      await filterTabs(info, tab);
      break;
    case "merge-snly-menu":
      info.which = "only";
      await filterTabs(info, tab);
      break;
    case "remove-visibility":
      excludeSite(tab);
      break;
    case "zdl-instructions":
      var dest_url = "https://tabmerger.herokuapp.com/instructions";
      chrome.tabs.create({ active: true, url: dest_url });
      break;
    case "dl-contact":
      var dest_url = "https://tabmerger.herokuapp.com/contact";
      chrome.tabs.create({ active: true, url: dest_url });
      break;

    default:
      await filterTabs(info, tab);
      break;
  }
};

/**
 * Any URL specified here will be excluded from TabMerger when a merging action is performed.
 * This means that it will be ignored even when other tabs are merged in.
 * @param {object} tab The tab which should be excluded from TabMerger's merging visibility
 */
function excludeSite(tab) {
  chrome.storage.sync.get("settings", (result) => {
    result.settings.blacklist +=
      result.settings.blacklist === "" ? `${tab.url}` : `, ${tab.url}`;
    chrome.storage.sync.set({ settings: result.settings });
  });
}

/**
 * Checks if a translation for a specific key is available and returns the translation.
 * @param {string} msg The key specified in the "_locales" folder corresponding to a translation from English
 *
 * @see ```./public/_locales/``` For key/value translation pairs
 *
 * @return {string} If key exists - translation from English to the corresponding language (based on user's Chrome Language settings),
 * Else - the original message
 *
 */
function translate(msg) {
  try {
    return chrome.i18n.getMessage(msg);
  } catch (err) {
    return msg;
  }
}

/*------------------------------- MAIN -----------------------------*/

// prettier-ignore
var info = { which: "all" }, tab = { index: 0 };

// ask the user to take a survey to figure out why they removed TabMerger
chrome.runtime.setUninstallURL("https://tabmerger.herokuapp.com/survey");

// when the user clicks the TabMerger icons in the browser's toolbar
chrome.browserAction.onClicked.addListener(handleBrowserIconClick);

// contextMenu creation
createContextMenu("aopen-tabmerger", translate("bgOpen"));
//--------------------------//
createContextMenu("first-separator", "separator", "separator");
createContextMenu("merge-all-menu", translate("bgAll"));
createContextMenu("merge-left-menu", translate("bgLeft"));
createContextMenu("merge-right-menu", translate("bgRight"));
createContextMenu("merge-xcluding-menu", translate("bgExclude"));
createContextMenu("merge-snly-menu", translate("bgOnly"));
//--------------------------//
createContextMenu("second-separator", "separator", "separator");
createContextMenu("remove-visibility", translate("bgSiteExclude"));
//--------------------------//
createContextMenu("third-separator", "separator", "separator");
createContextMenu("zdl-instructions", translate("bgInstructions"));
createContextMenu("dl-contact", translate("bgContact"));

// merge button clicks
chrome.runtime.onMessage.addListener(extensionMessage);

// context menu actions
chrome.contextMenus.onClicked.addListener(contextMenuOrShortCut);

// shortcut keyboard
chrome.commands.onCommand.addListener(contextMenuOrShortCut);
