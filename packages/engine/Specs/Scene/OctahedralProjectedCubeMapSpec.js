import {
  Cartesian3,
  defined,
  ComputeEngine,
  Pass,
  OctahedralProjectedCubeMap,
} from "../../index.js";

import createContext from "../../../../Specs/createContext.js";
import createFrameState from "../../../../Specs/createFrameState.js";
import pollToPromise from "../../../../Specs/pollToPromise.js";

describe(
  "Scene/OctahedralProjectedCubeMap",
  function () {
    let context;
    let computeEngine;
    let octahedralMap;

    const environmentMapUrl =
      "./Data/EnvironmentMap/kiara_6_afternoon_2k_ibl.ktx2";
    const fsOctahedralMap =
      "uniform sampler2D projectedMap;" +
      "uniform vec2 textureSize;" +
      "uniform vec3 direction;" +
      "uniform float lod;" +
      "uniform float maxLod;" +
      "void main() {" +
      "   vec3 color = czm_sampleOctahedralProjection(projectedMap, textureSize, direction, lod, maxLod);" +
      "   out_FragColor = vec4(color, 1.0);" +
      "}";

    const fsCubeMap =
      "uniform samplerCube cubeMap;" +
      "uniform vec3 direction;" +
      "void main() {" +
      "   vec4 rgba = czm_textureCube(cubeMap, direction);" +
      "   out_FragColor = vec4(rgba.rgb, 1.0);" +
      "}";

    beforeAll(function () {
      context = createContext();
      computeEngine = new ComputeEngine(context);
    });

    afterAll(function () {
      context.destroyForSpecs();
      computeEngine.destroy();
    });

    afterEach(function () {
      octahedralMap = octahedralMap && octahedralMap.destroy();
      context.textureCache.destroyReleasedTextures();
    });

    function executeCommands(frameState) {
      const length = frameState.commandList.length;
      for (let i = 0; i < length; ++i) {
        const command = frameState.commandList[i];
        if (command.pass === Pass.COMPUTE) {
          command.execute(computeEngine);
        } else {
          command.execute(context);
        }
      }
      frameState.commandList.length = 0;
    }

    function sampleOctahedralMap(octahedralMap, direction, lod, callback) {
      expect({
        context: context,
        fragmentShader: fsOctahedralMap,
        uniformMap: {
          projectedMap: function () {
            return octahedralMap.texture;
          },
          textureSize: function () {
            return octahedralMap.texture.dimensions;
          },
          direction: function () {
            return direction;
          },
          lod: function () {
            return lod;
          },
          maxLod: function () {
            return octahedralMap.maximumMipmapLevel;
          },
        },
      }).contextToRenderAndCall(callback);
    }

    function sampleCubeMap(cubeMap, direction, callback) {
      expect({
        context: context,
        fragmentShader: fsCubeMap,
        uniformMap: {
          cubeMap: function () {
            return cubeMap;
          },
          direction: function () {
            return direction;
          },
        },
      }).contextToRenderAndCall(callback);
    }

    function expectCubeMapAndOctahedralMapEqual(octahedralMap, direction, lod) {
      return sampleCubeMap(octahedralMap._cubeMaps[lod], direction, function (
        cubeMapColor
      ) {
        const directionFlipY = direction.clone();
        directionFlipY.y *= -1;

        sampleOctahedralMap(octahedralMap, directionFlipY, lod, function (
          octahedralMapColor
        ) {
          return expect(cubeMapColor).toEqualEpsilon(octahedralMapColor, 6);
        });
      });
    }

    it("creates a packed texture with the right dimensions", async function () {
      if (!OctahedralProjectedCubeMap.isSupported(context)) {
        return;
      }

      octahedralMap = new OctahedralProjectedCubeMap(environmentMapUrl);
      const frameState = createFrameState(context);

      await pollToPromise(function () {
        octahedralMap.update(frameState);
        return octahedralMap.ready;
      });
      expect(octahedralMap.texture.width).toEqual(770);
      expect(octahedralMap.texture.height).toEqual(512);
      expect(octahedralMap.maximumMipmapLevel).toEqual(7);
    });

    it("correctly projects the given cube map and all mip levels", async function () {
      if (!OctahedralProjectedCubeMap.isSupported(context)) {
        return;
      }

      octahedralMap = new OctahedralProjectedCubeMap(environmentMapUrl);
      const frameState = createFrameState(context);

      await pollToPromise(function () {
        // We manually call update and execute the commands
        // because calling scene.renderForSpecs does not
        // actually execute these commands, and we need
        // to get the output of the texture.
        octahedralMap.update(frameState);
        executeCommands(frameState);

        return octahedralMap.ready;
      });
      const directions = {
        positiveX: new Cartesian3(1, 0, 0),
        negativeX: new Cartesian3(-1, 0, 0),
        positiveY: new Cartesian3(0, 1, 0),
        negativeY: new Cartesian3(0, -1, 0),
        positiveZ: new Cartesian3(0, 0, 1),
        negativeZ: new Cartesian3(0, 0, -1),
      };

      // The projection is less accurate for the last mip levels,
      // where the input cubemap only has a few samples.
      const lastAccurateMip = octahedralMap.maximumMipmapLevel - 2;
      for (let mipLevel = 0; mipLevel < lastAccurateMip; mipLevel++) {
        for (const key in directions) {
          if (directions.hasOwnProperty(key)) {
            const direction = directions[key];

            expectCubeMapAndOctahedralMapEqual(
              octahedralMap,
              direction,
              mipLevel
            );
          }
        }
      }
    });

    it("caches projected textures", function () {
      if (!OctahedralProjectedCubeMap.isSupported(context)) {
        return;
      }

      const projection = new OctahedralProjectedCubeMap(environmentMapUrl);
      const frameState = createFrameState(context);

      return pollToPromise(function () {
        projection.update(frameState);
        return projection.ready;
      })
        .then(function () {
          const projection2 = new OctahedralProjectedCubeMap(environmentMapUrl);
          projection2.update(frameState);
          expect(projection2.ready).toEqual(true);
          expect(projection.texture).toEqual(projection2.texture);
          projection2.destroy();
        })
        .finally(function () {
          projection.destroy();
        });
    });

    it("raises error event when environment map fails to load.", async function () {
      if (!OctahedralProjectedCubeMap.isSupported(context)) {
        return;
      }

      const projection = new OctahedralProjectedCubeMap("http://invalid.url");
      const frameState = createFrameState(context);
      let error;

      const promise = new Promise((resolve, reject) => {
        const removeListener = projection.errorEvent.addEventListener((e) => {
          error = e;
          expect(error).toBeDefined();
          expect(projection.ready).toEqual(false);
          removeListener();
          resolve();
        });
      });

      await pollToPromise(function () {
        projection.update(frameState);
        return defined(error);
      });

      return promise;
    });
  },
  "WebGL"
);
