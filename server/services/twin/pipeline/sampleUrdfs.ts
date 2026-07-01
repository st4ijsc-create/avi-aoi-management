/**
 * T2a — SAMPLE URDF fixtures. A simple 3-DOF articulated arm + a 2-DOF planar arm,
 * authored with PRIMITIVE geometry (box/cylinder) so the pipeline can convert them
 * end-to-end without any external mesh file. Used by the pipeline tests AND available as
 * a seedable "convertible source" so the model registry can be filled with a real,
 * renderable glTF out of the box. Units are METRES / RADIANS (URDF convention).
 */

/** A simple 3-DOF arm: base → shoulder(revolute Z) → elbow(revolute Y) → wrist(revolute Y). */
export const SAMPLE_URDF_3DOF_ARM = `<?xml version="1.0"?>
<robot name="sample_3dof_arm">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0.05" rpy="0 0 0"/>
      <geometry><cylinder radius="0.08" length="0.1"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0.05" rpy="0 0 0"/>
      <geometry><cylinder radius="0.08" length="0.1"/></geometry>
    </collision>
  </link>
  <link name="link1">
    <visual>
      <origin xyz="0 0 0.15" rpy="0 0 0"/>
      <geometry><box size="0.06 0.06 0.3"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0.15" rpy="0 0 0"/>
      <geometry><box size="0.06 0.06 0.3"/></geometry>
    </collision>
  </link>
  <link name="link2">
    <visual>
      <origin xyz="0 0 0.125" rpy="0 0 0"/>
      <geometry><box size="0.05 0.05 0.25"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0.125" rpy="0 0 0"/>
      <geometry><box size="0.05 0.05 0.25"/></geometry>
    </collision>
  </link>
  <link name="tool_link">
    <visual>
      <origin xyz="0 0 0.03" rpy="0 0 0"/>
      <geometry><sphere radius="0.04"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0.03" rpy="0 0 0"/>
      <geometry><sphere radius="0.04"/></geometry>
    </collision>
  </link>

  <joint name="shoulder" type="revolute">
    <parent link="base_link"/>
    <child link="link1"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14159" upper="3.14159" effort="150" velocity="3.14"/>
  </joint>
  <joint name="elbow" type="revolute">
    <parent link="link1"/>
    <child link="link2"/>
    <origin xyz="0 0 0.3" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-2.35619" upper="2.35619" effort="100" velocity="3.14"/>
  </joint>
  <joint name="wrist" type="revolute">
    <parent link="link2"/>
    <child link="tool_link"/>
    <origin xyz="0 0 0.25" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-1.5708" upper="1.5708" effort="50" velocity="3.14"/>
  </joint>
</robot>`;

/** A minimal 2-DOF planar arm (both revolute about Z) — tiny fixture for parser tests. */
export const SAMPLE_URDF_2DOF_PLANAR = `<?xml version="1.0"?>
<robot name="sample_2dof_planar">
  <link name="base">
    <visual><origin xyz="0 0 0" rpy="0 0 0"/><geometry><box size="0.1 0.1 0.05"/></geometry></visual>
  </link>
  <link name="upper">
    <visual><origin xyz="0.1 0 0" rpy="0 0 0"/><geometry><box size="0.2 0.04 0.04"/></geometry></visual>
    <collision><origin xyz="0.1 0 0" rpy="0 0 0"/><geometry><box size="0.2 0.04 0.04"/></geometry></collision>
  </link>
  <link name="fore">
    <visual><origin xyz="0.075 0 0" rpy="0 0 0"/><geometry><box size="0.15 0.03 0.03"/></geometry></visual>
    <collision><origin xyz="0.075 0 0" rpy="0 0 0"/><geometry><box size="0.15 0.03 0.03"/></geometry></collision>
  </link>

  <joint name="j1" type="revolute">
    <parent link="base"/><child link="upper"/>
    <origin xyz="0 0 0.05" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-2.4435" upper="2.4435" effort="80" velocity="3.0"/>
  </joint>
  <joint name="j2" type="revolute">
    <parent link="upper"/><child link="fore"/>
    <origin xyz="0.2 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-2.618" upper="2.618" effort="60" velocity="3.0"/>
  </joint>
</robot>`;
