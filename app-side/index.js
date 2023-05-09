import { MessageBuilder } from "../shared/message";

const messageBuilder = new MessageBuilder();

function getSensorsList() {
  return settings.settingsStorage.getItem("sensorsList")
    ? JSON.parse(settings.settingsStorage.getItem("sensorsList"))
    : [];
}

async function fetchRequest(url, path, fetchParams = {}) {
  const token = settings.settingsStorage.getItem("HAToken");
  const res = await fetch({
    url: url + path,
    method: "GET",
    ...fetchParams,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...fetchParams.headers,
    },
  });
  return res;
}

async function request(path, fetchParams) {
  const localHAIP = settings.settingsStorage.getItem("localHAIP");
  const externalHAIP = settings.settingsStorage.getItem("externalHAIP");
  const hasLocalIP = typeof localHAIP === "string";
  const hasExternalIP = typeof externalHAIP === "string";
  if (!hasLocalIP && !hasExternalIP) {
    throw new Error('No addresses to requests');
  }
  let error;
  if (hasLocalIP) {
    try {
      const res = await fetchRequest(localHAIP, path, fetchParams);
      return res;
    } catch (e) {
      error = e;
    }
  }
  if (hasExternalIP) {
    try {
      const res = await fetchRequest(externalHAIP, path, fetchParams);
      return res;
    } catch (e) {
      error = e;
    }
  }
  throw new Error('Connection error');
}

async function getEnabledSensors() {
  const { body } = await request("/api/states");
  const sensors = typeof body === "string" ? JSON.parse(body) : body;
  const enabledSensors = getSensorsList()
    .filter((item) => item.value)
    .map((item) => {
      const actualSensor = sensors.find((it) => it.entity_id === item.key);
      if (!actualSensor) return null;
      let title = actualSensor.entity_id;
      let state = actualSensor.state;
      if (actualSensor.attributes) {
        if (typeof actualSensor.attributes.friendly_name === "string") {
          title = actualSensor.attributes.friendly_name;
        }
        if (typeof actualSensor.attributes.unit_of_measurement === "string") {
          state += actualSensor.attributes.unit_of_measurement;
        }
      }
      return {
        key: actualSensor.entity_id,
        title,
        state,
        type: actualSensor.entity_id.split(".")[0],
      };
    })
    .filter((item) => item);
  return enabledSensors;
}

AppSideService({
  onInit() {
    console.log("onInit");
    messageBuilder.listen(() => {});
    settings.settingsStorage.addListener(
      "change",
      async ({ key, newValue, oldValue }) => {
        if (key === "sensorsList") {
          const enabledSensors = await getEnabledSensors();
          messageBuilder.call({
            action: "listUpdate",
            value: enabledSensors,
          });
        }
        if (key === "listFetchRandom") {
          const { body } = await request("/api/states");
          const res = typeof body === "string" ? JSON.parse(body) : body;
          const sensorsList = res.map((item) => {
            let title = item.entity_id;
            if (
              item.attributes &&
              typeof item.attributes.friendly_name === "string"
            ) {
              title = item.attributes.friendly_name;
            }
            return {
              key: item.entity_id,
              title,
            };
          });
          const newStr = JSON.stringify(sensorsList);
          settings.settingsStorage.setItem("sensorsList", newStr);
        }
      }
    );
    messageBuilder.on("request", async (ctx) => {
      const payload = messageBuilder.buf2Json(ctx.request.payload);
      if (payload.method === "TOGGLE_SWITCH") {
        let state = "off";
        let service = "switch";
        if (payload.value) {
          state = "on";
        }
        if (payload.service) {
          service = payload.service;
        }
        await request(`/api/services/${service}/turn_${state}`, {
          method: "POST",
          body: JSON.stringify({
            entity_id: payload.entity_id,
          }),
        });
        ctx.response({ data: { result: [] } });
      }
      if (payload.method === "GET_SENSORS_LIST") {
        try {
          const enabledSensors = await getEnabledSensors();
          ctx.response({ data: { result: enabledSensors } });
        } catch (e) {
          ctx.response({ data: { error: e.message } });
        }
      }
    });
  },

  async onRun() {
    console.log("onRun");
  },

  onDestroy() {},
});
