import { Card, CardBody, CardHeader } from '@heroui/card';
import { Chip } from '@heroui/chip';
import { Divider } from '@heroui/divider';
import { Image } from '@heroui/image';
import { Link } from '@heroui/link';
import { Spinner } from '@heroui/spinner';
import { useRequest } from 'ahooks';
import { BsCodeSlash, BsCpu, BsGithub, BsGlobe, BsPlugin } from 'react-icons/bs';
import { IoDocument, IoRocketSharp } from 'react-icons/io5';
import { PROJECT_GITHUB_URL, PROJECT_NAME, PROJECT_RELEASES_URL } from 'napcat-common/src/project-repository';

import logo from '@/assets/images/logo.png';
import WebUIManager from '@/controllers/webui_manager';

function VersionInfo () {
  const { data, loading, error } = useRequest(WebUIManager.GetNapCatVersion);

  return (
    <div className='flex items-center gap-2'>
      {error
        ? <Chip color='danger' variant='flat' size='sm'>{error.message}</Chip>
        : loading
          ? <Spinner size='sm' color='default' />
          : (
            <div className='flex flex-wrap items-center gap-2'>
              <Chip size='sm' color='default' variant='flat' className='text-default-500'>WebUI 组件 v0.0.6</Chip>
              <Chip size='sm' color='primary' variant='flat'>项目发行 {data?.version}</Chip>
              {data?.updateMode === 'image' && <Chip size='sm' color='warning' variant='flat'>Docker 镜像</Chip>}
            </div>
          )}
    </div>
  );
}

export default function AboutPage () {
  const features = [
    {
      icon: <IoRocketSharp size={20} />,
      title: '原生接口',
      desc: '使用 QQ 自身运行时与原生服务接口。',
      className: 'bg-primary-50 text-primary',
    },
    {
      icon: <BsGlobe size={20} />,
      title: 'Linux 维护',
      desc: '优先跟进 Linux QQ x64，其他平台按实际验证范围支持。',
      className: 'bg-success-50 text-success',
    },
    {
      icon: <BsCodeSlash size={20} />,
      title: 'OneBot 11',
      desc: '提供 OneBot 11 接口与事件适配。',
      className: 'bg-warning-50 text-warning',
    },
    {
      icon: <BsPlugin size={20} />,
      title: '插件扩展',
      desc: '保留 API、插件和 WebHook 扩展能力。',
      className: 'bg-secondary-50 text-secondary',
    },
  ];

  const links = [
    { icon: <BsGithub />, name: '本项目 GitHub', href: PROJECT_GITHUB_URL },
    { icon: <IoRocketSharp />, name: '本项目发行', href: PROJECT_RELEASES_URL },
    { icon: <IoDocument />, name: '本项目文档', href: `${PROJECT_GITHUB_URL}/blob/main/README.md` },
    { icon: <IoDocument />, name: '核心原始许可证', href: 'https://github.com/NapNeko/NapCatQQ/blob/main/LICENSE' },
    { icon: <BsGithub />, name: 'WebUI 原始来源', href: 'https://github.com/bietiaop/NextNapCatWebUI' },
    { icon: <IoDocument />, name: 'WebUI 组件 MIT 许可证', href: `${PROJECT_GITHUB_URL}/blob/main/packages/napcat-webui-frontend/LICENSE` },
  ];

  const cardStyle = 'bg-default/40 backdrop-blur-lg border-none shadow-none';

  return (
    <div className='flex flex-col h-full w-full gap-6 p-2 md:p-6'>
      <title>{`关于 - ${PROJECT_NAME} WebUI`}</title>

      <div className='flex flex-col gap-2'>
        <h1 className='text-2xl font-bold flex items-center gap-3 text-default-900'>
          <Image src={logo} alt={`${PROJECT_NAME} Logo`} width={32} height={32} />
          关于 {PROJECT_NAME}
        </h1>
        <div className='flex flex-wrap items-center gap-4 text-small text-default-500'>
          <p>用于个人使用的 QQ 框架维护版本</p>
          <Divider orientation='vertical' className='h-4' />
          <VersionInfo />
        </div>
      </div>

      <Divider className='opacity-50' />

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 flex-grow'>
        <div className='lg:col-span-2 space-y-6'>
          <Card shadow='sm' className={cardStyle}>
            <CardHeader className='pb-0 pt-4 px-4 flex-col items-start'>
              <h2 className='text-lg font-bold'>项目简介</h2>
            </CardHeader>
            <CardBody className='py-4 text-default-600 leading-relaxed space-y-2'>
              <p>{PROJECT_NAME} 基于 NapCat v4.18.42 源码维护，使用独立的 0.0.x 发行版本，并跟进 Linux QQ 的接口与运行时变化。</p>
              <p>版本检测、发行下载和维护文档来自本项目仓库。原始核心与 WebUI 组件的版权、许可证和来源信息予以保留。</p>
            </CardBody>
          </Card>

          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            {features.map((item, index) => (
              <Card key={index} shadow='sm' className={cardStyle}>
                <CardBody className='flex flex-row items-start gap-4 p-4'>
                  <div className={`p-3 rounded-lg ${item.className}`}>{item.icon}</div>
                  <div>
                    <h3 className='font-semibold text-default-900'>{item.title}</h3>
                    <p className='text-small text-default-500 mt-1'>{item.desc}</p>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>

        <div className='space-y-6'>
          <Card shadow='sm' className={cardStyle}>
            <CardHeader className='pb-0 pt-4 px-4'><h2 className='text-lg font-bold'>项目与来源</h2></CardHeader>
            <CardBody className='py-4 space-y-4'>
              <div className='flex flex-col gap-2'>
                {links.map((link, idx) => (
                  <Link key={idx} isExternal href={link.href} className='flex items-center justify-between p-3 rounded-xl hover:bg-default-100/50 transition-colors text-default-600'>
                    <span className='flex items-center gap-3'>{link.icon}{link.name}</span>
                    <span className='text-tiny text-default-400'>跳转 &rarr;</span>
                  </Link>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card shadow='sm' className={cardStyle}>
            <CardHeader className='pb-0 pt-4 px-4'><h2 className='text-lg font-bold flex items-center gap-2'><BsCpu /> 技术栈</h2></CardHeader>
            <CardBody className='py-4'>
              <div className='flex flex-wrap gap-2'>
                {['TypeScript', 'React', 'Vite', 'Node.js', 'Electron', 'HeroUI'].map(tech => (
                  <Chip key={tech} size='sm' variant='flat' className='bg-default-100/50 text-default-600'>{tech}</Chip>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className='w-full text-center text-tiny text-default-400 py-4 mt-auto flex flex-col items-center gap-1'>
        <p>基于 NapCat 与 NextNapCatWebUI 维护，原始作者与许可见来源链接。</p>
        <p>WebUI 组件：MIT License © 2024 bietiaop；核心使用原始 NapCat 许可证。</p>
      </div>
    </div>
  );
}
