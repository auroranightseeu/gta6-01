import * as THREE from 'three';

// Golden hour, the default look: a low warm sun from the west (the sea side, -x), a warm
// fill and a coloured haze. Lighting and colour only — no extra light, no extra shadow map.
// render.js keeps its single 2048 shadow camera; the sun just sits low, so a 20 m block
// throws a ~65 m shadow across the street instead of an 11 m stub.
const SUN_COLOR = 0xffb347;
const SUN_INTENSITY = 4.05;
const FOG = 0xe8a87c;

// Direction TOWARD the sun: ~17 deg elevation, west-north-west.
const TO_SUN = new THREE.Vector3(-0.90, 0.30, -0.32).normalize();
const SUN_DIST = 220;

export function applyGoldenHour(scene) {
  if (!scene || scene.userData.goldenHour) return scene;
  scene.userData.goldenHour = true;

  scene.fog = new THREE.Fog(FOG, 45, 285);
  scene.background = new THREE.Color(FOG);

  let sun = null;
  scene.traverse((o) => {
    if (o.isDirectionalLight) sun = o;
    else if (o.isHemisphereLight) {
      o.color.setHex(0xffc48a);
      o.groundColor.setHex(0x5d4636);
      o.intensity = 2.4;
    } else if (o.isAmbientLight) {
      o.color.setHex(0xffd2a0);
      o.intensity = 0.5;
    }
  });
  if (!sun) return scene;

  sun.color.setHex(SUN_COLOR);
  sun.intensity = SUN_INTENSITY;

  // render.js rewrites sun.position from SUN_DIR every frame (it slides the shadow box to
  // follow the player), so a one-shot write would be undone before the shadow pass. The
  // vector's own set() is wrapped instead: render.js still supplies the tracked target on
  // sun.target, and the write is remapped onto the golden direction, so the shadow map and
  // the direct light agree inside the same frame.
  const pos = sun.position;
  if (!pos.__golden) {
    const write = pos.set.bind(pos);
    pos.set = () => {
      const t = sun.target.position;
      return write(t.x + TO_SUN.x * SUN_DIST, TO_SUN.y * SUN_DIST, t.z + TO_SUN.z * SUN_DIST);
    };
    pos.__golden = true;
  }
  sun.target.position.set(sun.target.position.x, 0, sun.target.position.z);
  pos.set();
  return scene;
}
