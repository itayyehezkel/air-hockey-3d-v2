/**
 * Single entry point for Babylon.js. Deep imports keep the bundle small
 * (the `@babylonjs/core` barrel pulls in the entire engine).
 */

// glTF/GLB loader (registers the .glb/.gltf plugin).
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
// Themed tables ship quantized (smaller files) and unlit (their texture has the concept's painted light).
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization';
import '@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit';

// Side-effect registrations for features used via scene/mesh methods.
import '@babylonjs/core/Culling/ray'; // scene.createPickingRay
import '@babylonjs/core/Particles/particleSystemComponent';

export { Engine } from '@babylonjs/core/Engines/engine';
export { Scene } from '@babylonjs/core/scene';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
export { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
export { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
export { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
export { Texture } from '@babylonjs/core/Materials/Textures/texture';
export { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
export { Mesh } from '@babylonjs/core/Meshes/mesh';
export { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
export { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode';
export { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
export { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
export { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
export { Ray } from '@babylonjs/core/Culling/ray';
export { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
